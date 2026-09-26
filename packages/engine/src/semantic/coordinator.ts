import type { Cancel, Scheduler } from "../ports.ts";
import type { EventId, SessionId } from "@logcayo/core";
import { AnnotationTable, type Annotation } from "./annotations.ts";
import type {
	ClassifierError,
	ClassifierItem,
	ClassifyRequest,
	LogClassifier,
	SemanticErrorKind,
	SemanticOptions,
	SemanticQuery,
} from "./contracts.ts";
import { encodedItemBytes, encodedRequestBytes, validateClassifyResponse } from "./validate.ts";
import { Match } from "effect";

export type ItemLookup = (id: EventId) => ClassifierItem | null;

export type SemanticMark = Annotation | { eventId: EventId; kind: "pending" | "unrequested" };

export type SemanticMarkChange = Readonly<{
	eventId: EventId;
	before: SemanticMark;
	after: SemanticMark;
}>;

export class SemanticCoordinator {
	readonly annotations = new AnnotationTable();
	private query: SemanticQuery | null = null;
	private requestSeq = 0;
	private generation = new AbortController();
	private flushCancel: Cancel | null = null;
	private inFlight = 0;
	private stopped = false;
	private failure: SemanticErrorKind | null = null;
	private readonly urgent: EventId[] = [];
	private readonly backfill: EventId[] = [];
	private readonly queued = new Set<EventId>();
	private readonly retried = new Set<string>();
	private readonly idleWaiters: Array<() => void> = [];
	private readonly inFlightRequests = new Map<string, Set<EventId>>();

	constructor(
		private readonly sessionId: SessionId,
		private readonly options: SemanticOptions,
		private readonly classifier: LogClassifier,
		private readonly scheduler: Scheduler,
		private readonly lookup: ItemLookup,
		private readonly onApplied: () => void,
		private readonly onMarkChange: (change: SemanticMarkChange) => void,
	) {}

	get inFlightCount(): number {
		return this.inFlight;
	}

	activeQuery(): SemanticQuery | null {
		return this.query;
	}

	get lastError(): SemanticErrorKind | null {
		return this.failure;
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
		this.inFlightRequests.clear();
		this.annotations.clear();
		this.failure = null;
		this.query = query;
		this.notifyIdle();
	}

	enqueue(ids: readonly EventId[], priority: "arrival" | "backfill"): void {
		if (this.query === null || this.stopped) return;

		const target = priority === "arrival" ? this.urgent : this.backfill;

		for (const id of ids) {
			if (this.queued.has(id) || this.annotations.get(id) !== undefined) continue;

			const before = this.markFor(id);

			if (this.queued.size >= this.options.maxQueuedIds) {
				this.setAnnotation({ eventId: id, kind: "unknown", reason: "skipped" }, before);
				continue;
			}

			target.push(id);
			this.queued.add(id);
			this.onMarkChange({ eventId: id, before, after: this.markFor(id) });
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

		for (const id of this.queued.keys()) {
			if (id < firstRetainedId) this.queued.delete(id);
		}

		for (const ids of this.inFlightRequests.values()) {
			for (const id of ids) {
				if (id < firstRetainedId) ids.delete(id);
			}
		}
	}

	forget(id: EventId): void {
		const before = this.markFor(id);

		if (before.kind === "pending" || before.kind === "unrequested") return;

		this.annotations.delete(id);
		this.onMarkChange({ eventId: id, before, after: this.markFor(id) });
	}

	markFor(id: EventId): SemanticMark {
		const stored = this.annotations.get(id);

		if (stored) return stored;

		if (this.queued.has(id) || this.isInFlight(id)) return { eventId: id, kind: "pending" };

		return { eventId: id, kind: "unrequested" };
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

	private isInFlight(id: EventId): boolean {
		for (const ids of this.inFlightRequests.values()) {
			if (ids.has(id)) return true;
		}

		return false;
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

			const before = this.markFor(id);
			this.queued.delete(id);

			if (this.annotations.get(id) !== undefined) continue;

			const item = this.lookup(id);

			if (item === null) continue;

			if (encodedItemBytes(item) > this.options.maxRequestBytes) {
				this.setAnnotation({ eventId: id, kind: "unknown", reason: "too-large" }, before);
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
		this.inFlightRequests.set(request.requestId, new Set(request.items.map((item) => item.eventId)));
		void this.runBatch(request, signal).finally(() => {
			this.inFlight -= 1;
			this.inFlightRequests.delete(request.requestId);
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
			this.failure = "invalid-response";
			this.failBatch(request);

			return;
		}

		this.failure = null;

		for (const item of validated.value.results) this.setAnnotation(item);

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

		this.failure = error.kind;
		this.failBatch(request);
	}

	private failBatch(request: ClassifyRequest): void {
		for (const item of request.items) {
			if (this.annotations.get(item.eventId) !== undefined) continue;

			this.setAnnotation({ eventId: item.eventId, kind: "unknown", reason: "failed" });
		}

		this.onApplied();
	}

	private setAnnotation(annotation: Annotation, before = this.markFor(annotation.eventId)): void {
		this.annotations.set(annotation);
		this.onMarkChange({ eventId: annotation.eventId, before, after: this.markFor(annotation.eventId) });
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
