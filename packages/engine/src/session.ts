import {
	EMPTY_VIEW,
	classificationColumnLayout,
	err,
	eventChargeBytes,
	logViewportHeight,
	matches,
	matchesLocal,
	ok,
	parseLogcatLine,
	planNavigation,
	prepareFilter,
	projectRows,
	requiresResize,
	eventScreenRows,
	materializeNavigation,
	validateDimensions,
	MAX_DECODED_SLICE_BYTES,
	MAX_NOTICE_MESSAGE_BYTES,
	MAX_SOURCE_NOTICES,
	NONE_CLASSIFICATION,
	type ClassificationMark,
	type CommandError,
	type EventId,
	type FilterSpec,
	type FramerState,
	type LineDisplay,
	type LogEvent,
	type PreparedFilter,
	type QueryCandidates,
	type Result,
	type SearchMode,
	type SessionCommand,
	type StartError,
	type ViewRow,
	type ViewState,
} from "@logview/core";
import { Effect, Match } from "effect";
import { fromResultEffect, runSyncResult } from "./result.ts";
import {
	defaultSessionOptions,
	validateSessionOptions,
	visibleLogRows,
	type PackageAttribution,
	type Session,
	type SessionDependencies,
	type SessionOptions,
	type SessionSnapshot,
	type SessionStats,
} from "./contracts.ts";
import { HistoryStore } from "./history.ts";
import { drainFrameSlice, emptyFramerState, IngestQueue } from "./ingest.ts";
import type {
	PackageTable,
	RecordedPackageTable,
	SourceEvent,
	SourceNotice,
	SourcePacket,
	SourceStatus,
	SourceTerminal,
} from "./ports.ts";
import { isSourcePacket, isSourceTerminal } from "./ports.ts";
import { FilterJob } from "./reindex.ts";
import { VisibleIndexStore } from "./visible-index.ts";
import { QueryVocabulary } from "./vocabulary.ts";
import { classifierItemFromEvent } from "./semantic/items.ts";
import { SemanticCoordinator, type SemanticMarkChange } from "./semantic/coordinator.ts";
import {
	defaultSemanticOptions,
	type SemanticOptions,
	type SemanticQuery,
	type SemanticStats,
} from "./semantic/contracts.ts";

export { defaultSessionOptions, validateSessionOptions };

const DATA_PUBLISH_MS = 1000 / 30;

type SemanticVisibleCounts = {
	classifiedEvents: number;
	relevantEvents: number;
	pendingEvents: number;
	skippedEvents: number;
	failedEvents: number;
};

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
	private pendingPackageFilter: Readonly<{ revision: number; prepared: PreparedFilter }> | null = null;
	private activePackageUids: readonly number[] | null = null;
	private pendingPackageUids: readonly number[] | null = null;
	private recordedPackageTable: RecordedPackageTable | null = null;
	private packageAttribution: PackageAttribution = { kind: "idle" };
	private requestedRevision = 0;
	private activeFilterRevision = 0;
	private activeFilter: FilterSpec;
	private columns: number;
	private rows: number;
	private lineDisplay: LineDisplay = "clip";
	private searchMode: SearchMode = "text";
	private readonly vocabulary = new QueryVocabulary();
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
	private readonly coordinator: SemanticCoordinator | null;
	private readonly semanticOptions: SemanticOptions;
	private queryRevision = 0;
	private semanticVisibleCounts: SemanticVisibleCounts = {
		classifiedEvents: 0,
		relevantEvents: 0,
		pendingEvents: 0,
		skippedEvents: 0,
		failedEvents: 0,
	};

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
		this.semanticOptions = { ...defaultSemanticOptions(), ...deps.semantic };
		this.coordinator = deps.classifier
			? new SemanticCoordinator(
					options.sessionId,
					this.semanticOptions,
					deps.classifier,
					deps.scheduler,
					(id) => {
						const event = this.history.get(id);

						return event ? classifierItemFromEvent(event) : null;
					},
					() => this.onSemanticApplied(),
					(change) => this.onSemanticMarkChange(change),
				)
			: null;

		if (this.coordinator) this.searchMode = "jev";

		if (this.coordinator && options.initialFilter.text.length > 0) {
			this.replaceSemanticQuery(options.initialFilter);
		}
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
		if (this.closed) return err({ kind: "stopped", message: "session is stopped" });

		return Match.value(command).pipe(
			Match.when({ kind: "move" }, (move) => this.commandNavigate(move)),
			Match.when({ kind: "page" }, (page) => this.commandNavigate(page)),
			Match.when({ kind: "oldest" }, (oldest) => this.commandNavigate(oldest)),
			Match.when({ kind: "tail" }, (tail) => {
				this.historyExpired = false;

				return this.commandNavigate(tail);
			}),
			Match.when({ kind: "toggle-line-display" }, () => this.commandToggleLineDisplay()),
			Match.when({ kind: "request-package-attribution" }, () => this.commandPackageAttribution()),
			Match.when({ kind: "toggle-search-mode" }, () => this.commandToggleSearchMode()),
			Match.when({ kind: "set-filter" }, (set) => this.commandSetFilter(set.filter, set.searchMode)),
			Match.when({ kind: "resize" }, (resize) => this.commandResize(resize.columns, resize.rows)),
			Match.exhaustive,
		);
	}

	snapshot(): SessionSnapshot {
		return this.buildSnapshot();
	}

	readMatches(after: EventId | null, limit: number): readonly LogEvent[] {
		if (!Number.isSafeInteger(limit) || limit < 1) return [];

		const matches: LogEvent[] = [];
		let rank = after === null ? 0 : (this.activeIndex.locate(after).nextRank ?? this.activeIndex.size);

		while (rank < this.activeIndex.size && matches.length < limit) {
			const id = this.activeIndex.at(rank++);

			if (id === null) break;
			const event = this.history.get(id);

			if (event) matches.push(event);
		}

		return matches;
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
		this.coordinator?.stop();
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
		this.syncSemanticQuery(prepared.value.spec);
		this.beginFilter(prepared.value, this.requestedRevision);
		this.bump();
		this.publishImmediate();

		return ok(undefined);
	}

	private commandSetFilter(filter: FilterSpec, searchMode: SearchMode | undefined): Result<void, CommandError> {
		if (searchMode === "jev" && !this.coordinator) {
			return err({ kind: "invalid-filter", field: "text", message: "Jev is not enabled for this session" });
		}

		if (searchMode !== undefined) this.searchMode = searchMode;

		return this.commandFilter(filter);
	}

	queryCandidates(): QueryCandidates {
		return this.vocabulary.candidates();
	}

	private commandPackageAttribution(): Result<void, CommandError> {
		void this.resolveSelectedPackageAttribution();

		return ok(undefined);
	}

	private commandToggleLineDisplay(): Result<void, CommandError> {
		this.lineDisplay = this.lineDisplay === "clip" ? "wrap" : "clip";
		this.applyNavigation({ kind: "resize" }, 0);
		this.bump();
		this.publishImmediate();

		return ok(undefined);
	}

	private commandToggleSearchMode(): Result<void, CommandError> {
		if (!this.coordinator) return ok(undefined);

		this.searchMode = this.searchMode === "text" ? "jev" : "text";

		return this.commandFilter(this.activeFilter);
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

		if (this.coordinator && this.semanticQueryActive()) {
			this.coordinator.flushNow();
			await this.coordinator.drain(this.abort.signal);
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
			Match.when({ kind: "package-table" }, (event) => {
				this.recordedPackageTable = event.packageTable;

				if (event.packageTable.kind === "recorded" && event.packageTable.table !== null) {
					this.rememberPackages(event.packageTable.table);
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

			if (parsed.metadata === null) {
				const attached = this.attachContinuation(admitted, parsed.rawText, line.omittedBytes, parsed.invalidUtf8);

				if (attached) continue;
			}

			if (!Number.isSafeInteger(this.nextEventId)) {
				this.failSource("event id space exhausted");

				return false;
			}

			const continuations: string[] = [];

			const event: LogEvent = {
				id: this.nextEventId,
				sourceOffsetMs: this.lastStdoutOffsetMs,
				rawText: parsed.rawText,
				metadata: parsed.metadata,
				continuations,
				endedWithLf: line.endedWithLf,
				omittedBytes: line.omittedBytes,
				invalidUtf8: parsed.invalidUtf8,
				chargeBytes: eventChargeBytes(parsed.rawText, continuations),
			};

			this.nextEventId += 1;
			admitted.push(event);
		}

		if (admitted.length > 0) this.commit(admitted);

		return drain.lines.length >= this.options.maxLinesPerSlice || (this.eof && !this.queue.empty);
	}

	private attachContinuation(
		admitted: LogEvent[],
		rawText: string,
		omittedBytes: number,
		invalidUtf8: boolean,
	): boolean {
		const pending = admitted[admitted.length - 1];

		if (pending) {
			const continuations = [...pending.continuations, rawText];
			admitted[admitted.length - 1] = {
				...pending,
				continuations,
				omittedBytes: pending.omittedBytes + omittedBytes,
				invalidUtf8: pending.invalidUtf8 || invalidUtf8,
				chargeBytes: eventChargeBytes(pending.rawText, continuations),
			};
			this.unparsedEvents += 1;

			return true;
		}

		const lastId = this.history.bounds().lastId;

		if (lastId === null) return false;

		const updated = this.history.appendContinuation(lastId, rawText, { omittedBytes, invalidUtf8 });

		if (!updated) return false;

		this.unparsedEvents += 1;
		this.refreshMatch(updated);
		this.bump();
		this.schedulePublish();

		return true;
	}

	private refreshMatch(event: LogEvent): void {
		this.coordinator?.forget(event.id);

		const matchesActive = this.eventMatches(event, this.preparedActive, this.activePackageUids);
		const semanticActive = this.semanticQueryActive();

		if (matchesActive && this.activeIndex.locate(event.id).exactRank === null) {
			this.activeIndex.append([event.id]);
			this.addVisibleSemanticCounts([event.id]);
		}

		if (this.pendingJob) {
			this.pendingJob.appendArrival(event.id, this.eventMatches(event, this.pendingJob.prepared, this.pendingPackageUids));
		}

		if (semanticActive && matchesActive) this.enqueueSemantic([event.id], "arrival");
	}

	private commit(events: readonly LogEvent[]): void {
		this.admittedEvents += events.length;

		for (const event of events) {
			this.vocabulary.add(event);

			if (event.metadata === null) this.unparsedEvents += 1;

			if (event.omittedBytes > 0) {
				this.truncatedEvents += 1;
				this.omittedBytes += event.omittedBytes;
			}
		}

		const outcome = this.history.append(events);
		this.evictedEvents += outcome.evictedCount;
		const firstId = this.history.bounds().firstId;

		this.pruneActiveBefore(firstId);
		this.pendingJob?.prefix.pruneBefore(firstId);
		this.pendingJob?.tail.pruneBefore(firstId);
		this.coordinator?.prune(firstId);

		const matchingNew: number[] = [];
		const pending = this.pendingJob;
		const newestPrepared = pending?.prepared ?? this.preparedActive;
		const semanticNew: number[] | null = this.semanticQueryActive(newestPrepared.spec) ? [] : null;

		for (const id of outcome.retainedNewIds) {
			const event = this.history.get(id);

			if (!event) continue;

			const activeMatches = this.eventMatches(event, this.preparedActive, this.activePackageUids);
			const pendingMatches = pending ? this.eventMatches(event, pending.prepared, this.pendingPackageUids) : false;
			const newestMatches = pending ? pendingMatches : activeMatches;

			if (activeMatches) matchingNew.push(id);

			if (pending) pending.appendArrival(id, pendingMatches);

			if (newestMatches && semanticNew) semanticNew.push(id);
		}

		this.activeIndex.append(matchingNew);
		this.addVisibleSemanticCounts(matchingNew);

		if (semanticNew) this.enqueueSemantic(semanticNew, "arrival");

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

	private beginFilter(prepared: PreparedFilter, revision: number): void {
		if (prepared.spec.packageName == null) {
			this.startFilter(prepared, revision, null);

			return;
		}

		this.pendingPackageFilter = { revision, prepared };
		void this.resolvePackageFilter(revision, prepared);
	}

	private async resolvePackageFilter(revision: number, prepared: PreparedFilter): Promise<void> {
		const table = await this.loadPackageTable();

		if (revision !== this.requestedRevision || this.closed) return;

		this.pendingPackageFilter = null;
		const packageName = prepared.spec.packageName;
		let uids = packageName == null || table === null ? [] : uidsForPackage(table, packageName);

		if (uids.length === 0 && packageName !== null && packageName !== undefined && this.recordedPackageTable === null) {
			const refreshed = await this.loadPackageTable(true);

			if (revision !== this.requestedRevision || this.closed) return;
			uids = refreshed === null ? [] : uidsForPackage(refreshed, packageName);
		}

		this.startFilter(prepared, revision, uids);
		this.bump();
		this.publishImmediate();
	}

	private startFilter(prepared: PreparedFilter, revision: number, packageUids: readonly number[] | null): void {
		this.pendingPackageFilter = null;
		this.pendingPackageUids = packageUids;
		this.pendingJob = new FilterJob(
			revision,
			prepared,
			this.history.bounds().lastId,
			this.matcherFor(prepared, packageUids),
		);
		this.runFilterSlice();
	}

	private runFilterSlice(): void {
		const job = this.pendingJob;

		if (!job || job.revision !== this.requestedRevision) {
			this.pendingJob = null;

			return;
		}

		const step = job.scanSlice(this.history, this.options.maxLinesPerSlice);

		if (!step.done) {
			this.filterCancel = this.deps.scheduler.after(0, () => this.runFilterSlice());

			return;
		}

		this.activeIndex = job.publish(this.history.bounds().firstId);
		this.preparedActive = job.prepared;
		this.activeFilter = job.prepared.spec;
		this.activeFilterRevision = job.revision;
		this.activePackageUids = this.pendingPackageUids;
		this.pendingPackageUids = null;
		this.pendingJob = null;
		this.historyExpired = false;
		this.resetSemanticVisibleCounts();

		const historyStart = Math.max(0, job.prefix.size - this.semanticOptions.historyEvents);
		this.enqueueSemantic(job.prefix.window(historyStart, this.semanticOptions.historyEvents), "backfill");

		this.applyNavigation({ kind: "filter-committed" }, 0);
		this.bump();
		this.schedulePublish();
	}

	private eventMatches(event: LogEvent, prepared: PreparedFilter, packageUids: readonly number[] | null): boolean {
		if (prepared.spec.packageName != null) {
			if (!event.metadata || event.metadata.uid == null || packageUids === null || !packageUids.includes(event.metadata.uid)) {
				return false;
			}
		}

		if (this.semanticQueryActive(prepared.spec)) return matchesLocal(event, prepared);

		return matches(event, prepared);
	}

	private matcherFor(prepared: PreparedFilter, packageUids: readonly number[] | null): (event: LogEvent) => boolean {
		return (event) => this.eventMatches(event, prepared, packageUids);
	}

	private async resolveSelectedPackageAttribution(): Promise<void> {
		const event = this.view.selectedId === null ? null : this.history.get(this.view.selectedId);

		if (!event?.metadata || event.metadata.uid == null) {
			this.packageAttribution = {
				kind: "unavailable",
				reason: this.recordedPackageTable?.kind === "not-recorded" ? "not-recorded" : "missing-uid",
			};
			this.bump();
			this.publishImmediate();

			return;
		}

		const expectedId = event.id;
		const uid = event.metadata.uid;
		this.packageAttribution = { kind: "resolving", uid };
		this.bump();
		this.publishImmediate();
		const table = await this.loadPackageTable();

		if (this.closed || this.view.selectedId !== expectedId) return;

		if (table === null) {
			this.packageAttribution = {
				kind: "unavailable",
				reason: this.recordedPackageTable?.kind === "not-recorded" ? "not-recorded" : "lookup-failed",
			};
		} else {
			let packages = packagesForUid(table, uid);

			if (packages.length === 0 && this.recordedPackageTable === null) {
				const refreshed = await this.loadPackageTable(true);

				if (this.closed || this.view.selectedId !== expectedId) return;
				packages = refreshed === null ? [] : packagesForUid(refreshed, uid);
			}

			this.packageAttribution = { kind: "resolved", uid, packages };
		}

		this.bump();
		this.publishImmediate();
	}

	private rememberPackages(table: PackageTable): void {
		const names: string[] = [];

		for (const entry of table) names.push(...entry.packages);

		this.vocabulary.setPackages(names);
	}

	private async loadPackageTable(refresh = false): Promise<PackageTable | null> {
		if (this.recordedPackageTable !== null) {
			return this.recordedPackageTable.kind === "recorded" ? this.recordedPackageTable.table : null;
		}

		const resolver = this.deps.packageResolver;

		if (!resolver) return null;
		const loaded = await (refresh && resolver.refresh ? resolver.refresh() : resolver.load());

		if (loaded.ok) this.rememberPackages(loaded.value);

		return loaded.ok ? loaded.value : null;
	}

	private semanticQueryActive(spec: FilterSpec = this.activeFilter): boolean {
		return this.searchMode === "jev" && this.coordinator !== null && spec.text.length > 0;
	}

	private syncSemanticQuery(spec: FilterSpec): void {
		if (!this.coordinator) return;

		if (!this.semanticQueryActive(spec)) {
			this.clearSemanticVisibleCounts();
			this.coordinator.setQuery(null);

			return;
		}

		this.replaceSemanticQuery(spec);
	}

	private replaceSemanticQuery(spec: FilterSpec): void {
		if (!this.coordinator) return;

		const next: SemanticQuery = {
			revision: this.queryRevision + 1,
			text: spec.text,
			threshold: this.semanticOptions.threshold,
			promptVersion: this.semanticOptions.promptVersion,
			redactionVersion: this.semanticOptions.redactionVersion,
		};

		this.queryRevision = next.revision;
		this.clearSemanticVisibleCounts();
		this.coordinator.setQuery({ ...next, revision: this.queryRevision });
	}

	private enqueueSemantic(ids: readonly number[], priority: "arrival" | "backfill"): void {
		const spec = this.pendingJob?.prepared.spec ?? this.activeFilter;

		if (!this.semanticQueryActive(spec) || !this.coordinator) return;

		this.coordinator.enqueue(ids, priority);
	}

	private onSemanticApplied(): void {
		if (this.closed || this.stopRequested || this.pendingJob) return;

		this.applyNavigation({ kind: "retention" }, 0);
		this.bump();
		this.schedulePublish();
	}

	private classifyRows(rows: readonly ViewRow[]): readonly ViewRow[] {
		if (!this.coordinator || !this.semanticQueryActive()) return rows;

		const next: ViewRow[] = [];

		for (const row of rows) {
			next.push({ ...row, classification: this.classificationMark(row.id) });
		}

		return next;
	}

	private classificationMark(id: number): ClassificationMark {
		if (!this.coordinator || !this.semanticQueryActive()) return NONE_CLASSIFICATION;

		const mark = this.coordinator.markFor(id);

		if (mark.kind === "scored") return { kind: "scored", relevance: mark.relevance };

		if (mark.kind === "unknown") return { kind: "unknown", reason: mark.reason };

		return { kind: mark.kind };
	}

	private semanticSnapshot(): SemanticStats | null {
		if (!this.coordinator) return null;

		const query = this.coordinator.activeQuery();

		return {
			queryText: query?.text ?? this.activeFilter.text,
			queryRevision: query?.revision ?? this.queryRevision,
			threshold: this.semanticThreshold(),
			...this.semanticVisibleCounts,
			inFlight: this.coordinator.inFlightCount,
			lastError: this.semanticQueryActive() ? this.coordinator.lastError : null,
		};
	}

	private semanticThreshold(): number {
		return this.coordinator?.activeQuery()?.threshold ?? this.semanticOptions.threshold;
	}

	private semanticDisplayActive(): boolean {
		return this.semanticQueryActive();
	}

	private clearSemanticVisibleCounts(): void {
		this.semanticVisibleCounts = {
			classifiedEvents: 0,
			relevantEvents: 0,
			pendingEvents: 0,
			skippedEvents: 0,
			failedEvents: 0,
		};
	}

	private resetSemanticVisibleCounts(): void {
		this.clearSemanticVisibleCounts();

		if (!this.semanticDisplayActive()) return;

		for (let rank = 0; rank < this.activeIndex.size; rank += 1) {
			const id = this.activeIndex.at(rank);

			if (id !== null) this.adjustSemanticCount(this.classificationMark(id), 1);
		}
	}

	private addVisibleSemanticCounts(ids: readonly number[]): void {
		if (!this.semanticDisplayActive()) return;

		for (const id of ids) this.adjustSemanticCount(this.classificationMark(id), 1);
	}

	private pruneActiveBefore(firstRetainedId: number | null): void {
		if (this.semanticDisplayActive()) {
			for (let rank = 0; rank < this.activeIndex.size; rank += 1) {
				const id = this.activeIndex.at(rank);

				if (id === null || (firstRetainedId !== null && id >= firstRetainedId)) break;

				this.adjustSemanticCount(this.classificationMark(id), -1);
			}
		}

		this.activeIndex.pruneBefore(firstRetainedId);
	}

	private onSemanticMarkChange(change: SemanticMarkChange): void {
		if (!this.semanticDisplayActive() || this.activeIndex.locate(change.eventId).exactRank === null) return;

		this.adjustSemanticCount(change.before, -1);
		this.adjustSemanticCount(change.after, 1);
	}

	private adjustSemanticCount(mark: ClassificationMark, direction: 1 | -1): void {
		if (mark.kind === "scored") {
			this.semanticVisibleCounts.classifiedEvents += direction;

			if (mark.relevance >= this.semanticThreshold()) this.semanticVisibleCounts.relevantEvents += direction;
		} else if (mark.kind === "pending") {
			this.semanticVisibleCounts.pendingEvents += direction;
		} else if (mark.kind === "unknown" && mark.reason === "skipped") {
			this.semanticVisibleCounts.skippedEvents += direction;
		} else if (mark.kind === "unknown" && (mark.reason === "failed" || mark.reason === "too-large")) {
			this.semanticVisibleCounts.failedEvents += direction;
		}
	}

	private applyNavigation(
		cause: Parameters<typeof planNavigation>[1],
		newMatchingArrivals: number,
	): void {
		const visibleHeight = Math.max(1, logViewportHeight(this.rows));
		const projectionColumns = this.projectionColumns();

		const plan = planNavigation(this.view, cause, {
			count: this.activeIndex.size,
			visibleHeight,
			rowHeightAt: (rank) => {
				const id = this.activeIndex.at(rank);
				const event = id === null ? null : this.history.get(id);

				return event ? eventScreenRows(event, projectionColumns, this.lineDisplay) : 1;
			},
			top: this.activeIndex.locate(this.view.topId),
			selected: this.activeIndex.locate(this.view.selectedId),
			newMatchingArrivals,
		});

		const selectedId = plan.selectedRank === null ? null : this.activeIndex.at(plan.selectedRank);
		const topId = plan.topRank === null ? null : this.activeIndex.at(plan.topRank);

		this.view = materializeNavigation(plan, { topId, selectedId });
	}

	private projectionColumns(): number {
		return this.semanticQueryActive() ? classificationColumnLayout(this.columns).listWidth : this.columns;
	}

	private buildSnapshot(): SessionSnapshot {
		const height = visibleLogRows(this.rows);
		const topRank = this.view.topId === null ? 0 : (this.activeIndex.locate(this.view.topId).exactRank ?? 0);
		const events: LogEvent[] = [];
		let used = 0;
		let rank = topRank;

		while (rank < this.activeIndex.size && used < height) {
			const id = this.activeIndex.at(rank);
			rank += 1;

			if (id === null) break;

			const event = this.history.get(id);

			if (!event) continue;

			events.push(event);
			used += eventScreenRows(event, this.projectionColumns(), this.lineDisplay);
		}

		const bounds = this.history.bounds();
		const pending = this.pendingJob;
		const pendingFilter = pending?.prepared ?? this.pendingPackageFilter?.prepared ?? null;
		let notice: SessionSnapshot["notice"] = null;

		if (requiresResize(this.columns, this.rows)) notice = "resize-required";
		else if (pendingFilter) notice = "applying-filter";
		else if (this.historyExpired) notice = "history-expired";

		const selectedEvent =
			this.view.selectedId === null ? null : (this.history.get(this.view.selectedId) ?? null);

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

		const projectionColumns = this.projectionColumns();

		return {
			sessionId: this.options.sessionId,
			sourceKind: this.options.sourceKind,
			label: this.options.label,
			revision: this.revision,
			source: this.sourceStatus,
			sourceNotices: this.notices.slice(),
			activeFilter: this.activeFilter,
			activeFilterRevision: this.activeFilterRevision,
			pendingFilter: pendingFilter?.spec ?? null,
			view: this.view,
			lineDisplay: this.lineDisplay,
			searchMode: this.searchMode,
			rows: this.classifyRows(projectRows(events, this.view.selectedId, projectionColumns, height, this.lineDisplay)),
			selectedEvent,
			packageAttribution: this.packageAttribution,
			stats,
			semantic: this.semanticSnapshot(),
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

function packagesForUid(table: PackageTable, uid: number): readonly string[] {
	return table.find((entry) => entry.uid === uid)?.packages ?? [];
}

function uidsForPackage(table: PackageTable, packageName: string): readonly number[] {
	return table.filter((entry) => entry.packages.includes(packageName)).map((entry) => entry.uid);
}

function truncateNotice(message: string): string {
	if (Buffer.byteLength(message, "utf8") <= MAX_NOTICE_MESSAGE_BYTES) return message;

	return Buffer.from(message, "utf8").subarray(0, MAX_NOTICE_MESSAGE_BYTES).toString("utf8");
}

function isError(cause: unknown): cause is Error {
	return cause instanceof Error;
}
