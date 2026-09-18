import {
	EMPTY_VIEW,
	err,
	eventChargeBytes,
	logViewportHeight,
	matches,
	ok,
	parseLogcatLine,
	planNavigation,
	prepareFilter,
	projectRows,
	requiresResize,
	materializeNavigation,
	validateDimensions,
	MAX_DECODED_SLICE_BYTES,
	MAX_NOTICE_MESSAGE_BYTES,
	MAX_SOURCE_NOTICES,
	type CommandError,
	type FilterSpec,
	type FramerState,
	type LogEvent,
	type PreparedFilter,
	type Result,
	type SessionCommand,
	type StartError,
	type ViewState,
} from "@logview/core";
import { Effect, Match } from "effect";
import { fromResultEffect, runSyncResult } from "./result.ts";
import {
	defaultSessionOptions,
	validateSessionOptions,
	visibleLogRows,
	type Session,
	type SessionDependencies,
	type SessionOptions,
	type SessionSnapshot,
	type SessionStats,
} from "./contracts.ts";
import { HistoryStore } from "./history.ts";
import { drainFrameSlice, emptyFramerState, IngestQueue } from "./ingest.ts";
import type { SourceEvent, SourceNotice, SourcePacket, SourceStatus, SourceTerminal } from "./ports.ts";
import { isSourcePacket, isSourceTerminal } from "./ports.ts";
import { FilterJob } from "./reindex.ts";
import { VisibleIndexStore } from "./visible-index.ts";

export { defaultSessionOptions, validateSessionOptions };

const DATA_PUBLISH_MS = 1000 / 30;

export function createSession(
	options: SessionOptions,
	dependencies: SessionDependencies,
): Result<Session, import("@logview/core").ConfigurationError> {
	return runSyncResult(
		Effect.gen(function* () {
			const validated = yield* fromResultEffect(validateSessionOptions(options, dependencies.source));

			return new SessionImpl(validated, dependencies);
		}),
	);
}

class SessionImpl implements Session {
	private readonly options: SessionOptions;
	private readonly deps: SessionDependencies;
	private readonly queueCapacity: number;
	private readonly history: HistoryStore;
	private readonly queue = new IngestQueue();
	private activeIndex = new VisibleIndexStore();
	private preparedActive: PreparedFilter;
	private view: ViewState = EMPTY_VIEW;
	private sourceStatus: SourceStatus = { kind: "idle" };
	private notices: SourceNotice[] = [];
	private pendingJob: FilterJob | null = null;
	private requestedRevision = 0;
	private activeFilterRevision = 0;
	private activeFilter: FilterSpec;
	private columns: number;
	private rows: number;
	private framer: FramerState = emptyFramerState();
	private nextEventId = 1;
	private revision = 0;
	private started = false;
	private stopRequested = false;
	private closed = false;
	private eof = false;
	private lastStdoutOffsetMs = 0;
	private historyExpired = false;
	private receivedBytes = 0;
	private admittedEvents = 0;
	private evictedEvents = 0;
	private unparsedEvents = 0;
	private truncatedEvents = 0;
	private omittedBytes = 0;
	private listeners = new Set<(snapshot: SessionSnapshot) => void>();
	private publishCancel: (() => void) | null = null;
	private filterCancel: (() => void) | null = null;
	private readonly abort = new AbortController();
	private sourceDoneResolve!: (terminal: SourceTerminal) => void;
	readonly sourceDone: Promise<SourceTerminal>;
	private consumeTask: Promise<void> | null = null;

	constructor(options: SessionOptions, deps: SessionDependencies) {
		this.options = options;
		this.deps = deps;
		this.queueCapacity = options.maxQueuedBytes - deps.source.maxBufferedBytes;
		this.history = new HistoryStore(options.maxEvents, options.maxHistoryChargeBytes);
		this.columns = options.columns;
		this.rows = options.rows;
		this.activeFilter = options.initialFilter;
		const prepared = prepareFilter(options.initialFilter);

		this.preparedActive = prepared.ok
			? prepared.value
			: { spec: options.initialFilter, foldedText: "" };

		this.sourceDone = new Promise((resolve) => {
			this.sourceDoneResolve = resolve;
		});
	}

	start(): Result<void, StartError> {
		if (this.closed) return err({ kind: "stopped" });
		if (this.started) return err({ kind: "already-started" });

		this.started = true;
		this.sourceStatus = { kind: "starting" };
		this.bump();
		this.consumeTask = this.consume();
		return ok(undefined);
	}

	dispatch(command: SessionCommand): Result<void, CommandError> {
		if (this.closed) return err({ kind: "stopped" });

		return Match.value(command).pipe(
			Match.when({ kind: "move" }, (move) => this.commandNavigate(move)),
			Match.when({ kind: "page" }, (page) => this.commandNavigate(page)),
			Match.when({ kind: "oldest" }, (oldest) => this.commandNavigate(oldest)),
			Match.when({ kind: "tail" }, (tail) => {
				this.historyExpired = false;
				return this.commandNavigate(tail);
			}),
			Match.when({ kind: "set-filter" }, (set) => this.commandFilter(set.filter)),
			Match.when({ kind: "resize" }, (resize) => this.commandResize(resize.columns, resize.rows)),
			Match.exhaustive,
		);
	}

	snapshot(): SessionSnapshot {
		return this.buildSnapshot();
	}

	subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async stop(): Promise<void> {
		if (this.closed && this.consumeTask) {
			await this.consumeTask;
			return;
		}

		this.stopRequested = true;
		this.abort.abort();
		this.filterCancel?.();
		this.publishCancel?.();
		await this.deps.source.close();
		await this.consumeTask;
		this.closed = true;
	}

	private commandNavigate(
		cause: Extract<SessionCommand, { kind: "move" | "page" | "oldest" | "tail" }>,
	): Result<void, CommandError> {
		this.applyNavigation(cause, 0);
		this.bump();
		this.publishImmediate();
		return ok(undefined);
	}

	private commandFilter(filter: FilterSpec): Result<void, CommandError> {
		const prepared = prepareFilter(filter);

		if (!prepared.ok) return prepared;

		this.requestedRevision += 1;
		this.filterCancel?.();
		this.pendingJob = new FilterJob(
			this.requestedRevision,
			prepared.value,
			this.history.bounds().lastId,
		);
		this.runFilterSlice();
		this.bump();
		this.publishImmediate();
		return ok(undefined);
	}

	private commandResize(columns: number, rows: number): Result<void, CommandError> {
		const dims = validateDimensions(columns, rows);

		if (!dims.ok) return dims;

		this.columns = dims.value.columns;
		this.rows = dims.value.rows;
		this.applyNavigation({ kind: "resize" }, 0);
		this.bump();
		this.publishImmediate();
		return ok(undefined);
	}

	private async consume(): Promise<void> {
		try {
			for await (const event of this.deps.source.open(this.abort.signal)) {
				if (this.stopRequested) break;

				if (isSourcePacket(event)) {
					await this.enqueuePacket(event);
				} else {
					this.handleControl(event);
				}

				while (this.processSlice()) {
					await this.deps.scheduler.yield();
				}
			}
		} catch (cause) {
			this.failSource(isError(cause) ? cause.message : "source failed");
		}

		this.eof = true;

		while (this.processSlice()) {
			await this.deps.scheduler.yield();
		}

		while (this.pendingJob !== null) {
			this.runFilterSlice();
			await this.deps.scheduler.yield();
		}

		this.finishSource();
		this.publishImmediate();
	}

	private async enqueuePacket(packet: SourcePacket): Promise<void> {
		this.receivedBytes += packet.bytes.byteLength;

		if (packet.stream !== "stdout") return;

		while (!this.queue.enqueue(packet, this.queueCapacity)) {
			if (this.stopRequested) return;

			this.processSlice();
			await this.deps.scheduler.yield();
		}
	}

	private handleControl(event: Exclude<SourceEvent, SourcePacket>): void {
		Match.value(event).pipe(
			Match.when({ kind: "ready" }, () => {
				if (this.sourceStatus.kind === "starting" || this.sourceStatus.kind === "idle") {
					this.sourceStatus = { kind: "running" };
				}
			}),
			Match.when({ kind: "notice" }, (notice) => {
				this.addNotice(notice);
			}),
			Match.when({ kind: "ended" }, (ended) => {
				if (!isSourceTerminal(this.sourceStatus) || this.sourceStatus.kind !== "failed") {
					this.sourceStatus = ended;
				}
			}),
			Match.when({ kind: "failed" }, (failed) => {
				this.sourceStatus = failed;
			}),
			Match.exhaustive,
		);
		this.bump();
	}

	private processSlice(): boolean {
		const drain = drainFrameSlice(this.framer, this.queue, this.eof, {
			maxLineBytes: this.options.maxLineBytes,
			maxLines: this.options.maxLinesPerSlice,
			maxDecodedBytes: MAX_DECODED_SLICE_BYTES,
		});

		this.framer = drain.state;

		if (drain.lastOffsetMs !== null) this.lastStdoutOffsetMs = drain.lastOffsetMs;

		const admitted: LogEvent[] = [];

		for (const line of drain.lines) {
			const parsed = parseLogcatLine(line);

			if (parsed.kind === "control") continue;

			if (!Number.isSafeInteger(this.nextEventId)) {
				this.failSource("event id space exhausted");
				return false;
			}

			const event: LogEvent = {
				id: this.nextEventId,
				sourceOffsetMs: this.lastStdoutOffsetMs,
				rawText: parsed.rawText,
				metadata: parsed.metadata,
				endedWithLf: line.endedWithLf,
				omittedBytes: line.omittedBytes,
				invalidUtf8: parsed.invalidUtf8,
				chargeBytes: eventChargeBytes(parsed.rawText),
			};

			this.nextEventId += 1;
			admitted.push(event);
		}

		if (admitted.length > 0) this.commit(admitted);

		return drain.consumed;
	}

	private commit(events: readonly LogEvent[]): void {
		this.admittedEvents += events.length;

		for (const event of events) {
			if (event.metadata === null) this.unparsedEvents += 1;
			if (event.omittedBytes > 0) {
				this.truncatedEvents += 1;
				this.omittedBytes += event.omittedBytes;
			}
		}

		const outcome = this.history.append(events);
		this.evictedEvents += outcome.evictedCount;
		const firstId = this.history.bounds().firstId;

		this.activeIndex.pruneBefore(firstId);
		this.pendingJob?.prefix.pruneBefore(firstId);
		this.pendingJob?.tail.pruneBefore(firstId);

		const matchingNew: number[] = [];

		for (const id of outcome.retainedNewIds) {
			const event = this.history.get(id);

			if (!event) continue;

			if (matches(event, this.preparedActive)) matchingNew.push(id);

			if (this.pendingJob) {
				this.pendingJob.appendArrival(id, matches(event, this.pendingJob.prepared));
			}
		}

		this.activeIndex.append(matchingNew);

		const selectedGone =
			this.view.mode === "browse" &&
			this.view.selectedId !== null &&
			this.activeIndex.locate(this.view.selectedId).exactRank === null;
		const topGone =
			this.view.mode === "browse" &&
			this.view.topId !== null &&
			this.activeIndex.locate(this.view.topId).exactRank === null;

		this.applyNavigation({ kind: "arrivals" }, matchingNew.length);

		if (selectedGone || topGone) this.historyExpired = true;

		this.bump();
		this.schedulePublish();
	}

	private runFilterSlice(): void {
		const job = this.pendingJob;

		if (!job || job.revision !== this.requestedRevision) {
			this.pendingJob = null;
			return;
		}

		const done = job.scanSlice(this.history, this.options.maxLinesPerSlice);

		if (!done) {
			this.filterCancel = this.deps.scheduler.after(0, () => this.runFilterSlice());
			return;
		}

		this.activeIndex = job.publish(this.history.bounds().firstId);
		this.preparedActive = job.prepared;
		this.activeFilter = job.prepared.spec;
		this.activeFilterRevision = job.revision;
		this.pendingJob = null;
		this.historyExpired = false;
		this.applyNavigation({ kind: "filter-committed" }, 0);
		this.bump();
		this.schedulePublish();
	}

	private applyNavigation(
		cause: Parameters<typeof planNavigation>[1],
		newMatchingArrivals: number,
	): void {
		const visibleHeight = Math.max(1, logViewportHeight(this.rows));
		const plan = planNavigation(this.view, cause, {
			count: this.activeIndex.size,
			visibleHeight,
			top: this.activeIndex.locate(this.view.topId),
			selected: this.activeIndex.locate(this.view.selectedId),
			newMatchingArrivals,
		});
		const selectedId = plan.selectedRank === null ? null : this.activeIndex.at(plan.selectedRank);
		const topId = plan.topRank === null ? null : this.activeIndex.at(plan.topRank);

		this.view = materializeNavigation(plan, { topId, selectedId });
	}

	private buildSnapshot(): SessionSnapshot {
		const height = visibleLogRows(this.rows);
		const topRank = this.view.topId === null ? 0 : (this.activeIndex.locate(this.view.topId).exactRank ?? 0);
		const ids = height <= 0 ? [] : this.activeIndex.window(topRank, height);
		const events: LogEvent[] = [];

		for (const id of ids) {
			const event = this.history.get(id);

			if (event) events.push(event);
		}

		const bounds = this.history.bounds();
		const pending = this.pendingJob;
		let notice: SessionSnapshot["notice"] = null;

		if (requiresResize(this.columns, this.rows)) notice = "resize-required";
		else if (pending) notice = "applying-filter";
		else if (this.historyExpired) notice = "history-expired";

		const stats: SessionStats = {
			receivedBytes: this.receivedBytes,
			admittedEvents: this.admittedEvents,
			retainedEvents: bounds.count,
			matchedEvents: this.activeIndex.size,
			evictedEvents: this.evictedEvents,
			unparsedEvents: this.unparsedEvents,
			truncatedEvents: this.truncatedEvents,
			omittedBytes: this.omittedBytes,
			queuedBytes: this.queue.queuedBytes,
			chargedHistoryBytes: bounds.chargedBytes,
			lagging: this.queue.queuedBytes > this.queueCapacity / 2,
			upstreamLoss: "unknown",
		};

		return {
			sessionId: this.options.sessionId,
			revision: this.revision,
			source: this.sourceStatus,
			sourceNotices: this.notices.slice(),
			activeFilter: this.activeFilter,
			activeFilterRevision: this.activeFilterRevision,
			pendingFilter: pending ? pending.prepared.spec : null,
			view: this.view,
			rows: projectRows(events, this.view.selectedId, this.columns),
			stats,
			notice,
		};
	}

	private addNotice(notice: SourceNotice): void {
		const message = truncateNotice(notice.message);
		const next: SourceNotice = { kind: "notice", code: notice.code, message };
		const existing = this.notices.findIndex((item) => item.code === next.code);

		if (existing >= 0) this.notices.splice(existing, 1);

		this.notices.push(next);

		while (this.notices.length > MAX_SOURCE_NOTICES) {
			this.notices.splice(0, 1);
		}
	}

	private failSource(message: string): void {
		if (this.sourceStatus.kind === "failed") return;

		this.sourceStatus = {
			kind: "failed",
			error: { kind: "io", message },
		};
		this.bump();
	}

	private finishSource(): void {
		if (this.sourceStatus.kind === "idle" || this.sourceStatus.kind === "starting" || this.sourceStatus.kind === "running") {
			this.sourceStatus = {
				kind: "ended",
				reason: this.stopRequested ? "stopped" : "eof",
			};
		}

		if (isSourceTerminal(this.sourceStatus)) {
			this.sourceDoneResolve(this.sourceStatus);
		} else {
			this.sourceDoneResolve({ kind: "ended", reason: "eof" });
		}

		this.closed = this.stopRequested;
	}

	private bump(): void {
		this.revision += 1;
	}

	private schedulePublish(): void {
		if (this.listeners.size === 0) return;
		if (this.publishCancel) return;

		this.publishCancel = this.deps.scheduler.after(DATA_PUBLISH_MS, () => {
			this.publishCancel = null;
			this.emit();
		});
	}

	private publishImmediate(): void {
		this.publishCancel?.();
		this.publishCancel = null;
		this.emit();
	}

	private emit(): void {
		if (this.listeners.size === 0) return;

		const snapshot = this.buildSnapshot();

		for (const listener of this.listeners) listener(snapshot);
	}
}

function truncateNotice(message: string): string {
	if (Buffer.byteLength(message, "utf8") <= MAX_NOTICE_MESSAGE_BYTES) return message;

	return Buffer.from(message, "utf8").subarray(0, MAX_NOTICE_MESSAGE_BYTES).toString("utf8");
}

function isError(cause: unknown): cause is Error {
	return cause instanceof Error;
}
