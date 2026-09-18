import type { Cancel, Scheduler } from "../ports.ts";
import type { EventId, SessionId } from "@logview/core";
import { AnnotationTable, type Annotation } from "./annotations.ts";
import type {
	ClassifierError,
	ClassifierItem,
	ClassifyRequest,
	LogClassifier,
	SemanticOptions,
	SemanticQuery,
	SemanticStats,
} from "./contracts.ts";
import { encodedItemBytes, encodedRequestBytes, validateClassifyResponse } from "./validate.ts";
import { Match } from "effect";
import type { VisibleIndexStore } from "../visible-index.ts";

export type ItemLookup = (id: EventId) => ClassifierItem | null;

export class SemanticCoordinator {
	readonly annotations = new AnnotationTable();
	private query: SemanticQuery | null = null;
	private requestSeq = 0;
	private generation = new AbortController();
	private flushCancel: Cancel | null = null;
	private inFlight = 0;
	private skipped = 0;
	private failed = 0;
	private stopped = false;
	private readonly urgent: EventId[] = [];
	private readonly backfill: EventId[] = [];
	private readonly queued = new Set<EventId>();
	private readonly retried = new Set<string>();
	private readonly idleWaiters: Array<() => void> = [];

	constructor(
		private readonly sessionId: SessionId,
		private readonly options: SemanticOptions,
		private readonly classifier: LogClassifier,
		private readonly scheduler: Scheduler,
		private readonly lookup: ItemLookup,
		private readonly onApplied: () => void,
	) {}

	activeQuery(): SemanticQuery | null {
		return this.query;
	}

	setQuery(query: SemanticQuery | null): void {
		this.generation.abort();
		this.generation = new AbortController();
		this.flushCancel?.();
		this.flushCancel = null;
		this.urgent.length = 0;
		this.backfill.length = 0;
		this.queued.clear();
		this.retried.clear();
		this.annotations.clear();
		this.skipped = 0;
		this.failed = 0;
		this.query = query;
		this.notifyIdle();
	}

	enqueue(ids: readonly EventId[], priority: "arrival" | "backfill"): void {
		if (this.query === null || this.stopped) return;

		const target = priority === "arrival" ? this.urgent : this.backfill;

		for (const id of ids) {
			if (this.queued.has(id) || this.annotations.get(id) !== undefined) continue;

			if (this.queued.size >= this.options.maxQueuedIds) {
				this.annotations.set({ eventId: id, kind: "unknown", reason: "skipped" });
				this.skipped += 1;
				continue;
			}

			target.push(id);
			this.queued.add(id);
		}

		if (this.queued.size >= this.options.maxBatchItems) {
			this.flushNow();

			return;
		}

		this.scheduleFlush();
	}

	prune(firstRetainedId: EventId | null): void {
		this.annotations.pruneBefore(firstRetainedId);
		this.dropBelow(this.urgent, firstRetainedId);
		this.dropBelow(this.backfill, firstRetainedId);

		if (firstRetainedId === null) {
			this.queued.clear();

			return;
		}

		for (const id of [...this.queued]) {
			if (id < firstRetainedId) this.queued.delete(id);
		}
	}

	forget(id: EventId): void {
		this.annotations.delete(id);
	}

	hideRejected(index: VisibleIndexStore): number {
		const query = this.query;

		if (query === null) return 0;

		let removed = 0;
		const ids = index.snapshotIds();

		for (const id of ids) {
			const mark = this.annotations.get(id);

			if (!mark || mark.kind !== "scored" || mark.relevance >= query.threshold) continue;

			if (index.remove(id)) removed += 1;
		}

		return removed;
	}

	markFor(id: EventId): Annotation | { eventId: EventId; kind: "pending" } {
		const stored = this.annotations.get(id);

		if (stored) return stored;

		return { eventId: id, kind: "pending" };
	}

	stats(): SemanticStats {
		const query = this.query;
		let classifiedEvents = 0;

		for (const mark of this.annotations.marks()) {
			if (mark.kind === "scored") classifiedEvents += 1;
		}

		return {
			queryText: query?.text ?? "",
			queryRevision: query?.revision ?? 0,
			threshold: query?.threshold ?? this.options.threshold,
			classifiedEvents,
			pendingEvents: this.queued.size,
			skippedEvents: this.skipped,
			failedEvents: this.failed,
			inFlight: this.inFlight,
		};
	}

	flushNow(): void {
		this.flushCancel?.();
		this.flushCancel = null;

		while (this.inFlight < this.options.maxInFlight) {
			const batch = this.takeBatch();

			if (batch === null) break;

			this.startBatch(batch);
		}

		this.notifyIdle();
	}

	async drain(signal: AbortSignal): Promise<void> {
		this.flushNow();

		if (this.inFlight === 0 && !this.hasQueued()) return;

		await new Promise<void>((resolve) => {
			const finish = (): void => {
				signal.removeEventListener("abort", finish);
				resolve();
			};

			if (signal.aborted) {
				resolve();

				return;
			}

			signal.addEventListener("abort", finish);
			this.idleWaiters.push(finish);
		});
	}

	stop(): void {
		this.stopped = true;
		this.generation.abort();
		this.flushCancel?.();
		this.flushCancel = null;
		this.notifyIdle();
	}

	private hasQueued(): boolean {
		return this.urgent.length > 0 || this.backfill.length > 0;
	}

	private scheduleFlush(): void {
		if (this.flushCancel !== null || this.query === null) return;

		this.flushCancel = this.scheduler.after(this.options.flushDelayMs, () => {
			this.flushCancel = null;
			this.flushNow();
		});
	}

	private takeBatch(): ClassifyRequest | null {
		const query = this.query;

		if (query === null) return null;

		const items: ClassifierItem[] = [];

		while (items.length < this.options.maxBatchItems) {
			const id = this.urgent.shift() ?? this.backfill.shift();

			if (id === undefined) break;

			this.queued.delete(id);

			if (this.annotations.get(id) !== undefined) continue;

			const item = this.lookup(id);

			if (item === null) continue;

			if (encodedItemBytes(item) > this.options.maxRequestBytes) {
				this.annotations.set({ eventId: id, kind: "unknown", reason: "too-large" });
				this.failed += 1;
				continue;
			}

			items.push(item);
			const encoded = encodedRequestBytes({
				sessionId: this.sessionId,
				requestId: "size",
				query,
				modelId: this.options.modelId,
				items,
			});

			if (encoded > this.options.maxRequestBytes) {
				items.pop();
				this.backfill.unshift(id);
				this.queued.add(id);
				break;
			}
		}

		if (items.length === 0) return null;

		this.requestSeq += 1;

		return {
			sessionId: this.sessionId,
			requestId: `${this.sessionId}-${this.requestSeq}`,
			query,
			modelId: this.options.modelId,
			items,
		};
	}

	private startBatch(request: ClassifyRequest): void {
		const signal = this.generation.signal;

		this.inFlight += 1;
		void this.runBatch(request, signal).finally(() => {
			this.inFlight -= 1;
			this.flushNow();
		});
	}

	private async runBatch(request: ClassifyRequest, signal: AbortSignal): Promise<void> {
		if (signal.aborted || this.stopped) return;

		const result = await this.classifier.classifyBatch(request, signal);

		if (signal.aborted || this.query === null || this.query.revision !== request.query.revision) {
			return;
		}

		if (!result.ok) {
			this.handleFailure(request, result.error);

			return;
		}

		const validated = validateClassifyResponse(request, result.value);

		if (!validated.ok) {
			this.failBatch(request);

			return;
		}

		for (const item of validated.value.results) this.annotations.set(item);

		this.onApplied();
	}

	private handleFailure(request: ClassifyRequest, error: ClassifierError): void {
		const retryable = Match.value(error.kind).pipe(
			Match.when("timeout", () => true),
			Match.when("rate-limited", () => true),
			Match.when("unavailable", () => true),
			Match.orElse(() => false),
		);

		if (retryable && !this.retried.has(request.requestId) && this.query?.revision === request.query.revision) {
			this.retried.add(request.requestId);
			const ids: EventId[] = [];

			for (const item of request.items) ids.push(item.eventId);

			this.enqueue(ids, "arrival");

			return;
		}

		if (error.kind === "cancelled") return;

		this.failBatch(request);
	}

	private failBatch(request: ClassifyRequest): void {
		for (const item of request.items) {
			if (this.annotations.get(item.eventId) !== undefined) continue;

			this.annotations.set({ eventId: item.eventId, kind: "unknown", reason: "failed" });
			this.failed += 1;
		}

		this.onApplied();
	}

	private dropBelow(ids: EventId[], firstRetainedId: EventId | null): void {
		if (firstRetainedId === null) {
			ids.length = 0;

			return;
		}

		let write = 0;

		for (let read = 0; read < ids.length; read += 1) {
			const id = ids[read]!;

			if (id >= firstRetainedId) {
				ids[write] = id;
				write += 1;
			}
		}

		ids.length = write;
	}

	private notifyIdle(): void {
		if (this.inFlight > 0 || this.hasQueued()) return;

		const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);

		for (const waiter of waiters) waiter();
	}
}
