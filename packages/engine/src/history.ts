import type { EventId, LogEvent } from "@logview/core";

export type HistoryBounds = Readonly<{
	firstId: EventId | null;
	lastId: EventId | null;
	count: number;
	chargedBytes: number;
}>;

export type AppendOutcome = Readonly<{
	retainedNewIds: readonly EventId[];
	evictedCount: number;
	evictedThrough: EventId | null;
}>;

export interface History {
	append(events: readonly LogEvent[]): AppendOutcome;
	get(id: EventId): LogEvent | undefined;
	bounds(): HistoryBounds;
	readAfter(after: EventId | null, through: EventId, limit: number): readonly LogEvent[];
}

export class HistoryStore implements History {
	private events: LogEvent[] = [];
	private start = 0;
	private charged = 0;
	private readonly byId = new Map<EventId, LogEvent>();

	constructor(
		private readonly maxEvents: number,
		private readonly maxChargeBytes: number,
	) {}

	append(events: readonly LogEvent[]): AppendOutcome {
		for (const event of events) {
			this.events.push(event);
			this.byId.set(event.id, event);
			this.charged += event.chargeBytes;
		}

		let evictedCount = 0;
		let evictedThrough: EventId | null = null;

		while (this.liveCount() > 0 && this.overCapacity()) {
			const evicted = this.events[this.start];

			if (!evicted) break;

			this.start += 1;
			this.charged -= evicted.chargeBytes;
			this.byId.delete(evicted.id);
			evictedCount += 1;
			evictedThrough = evicted.id;
		}

		this.compact();

		const retainedNewIds: EventId[] = [];

		for (const event of events) {
			if (this.byId.has(event.id)) retainedNewIds.push(event.id);
		}

		return { retainedNewIds, evictedCount, evictedThrough };
	}

	get(id: EventId): LogEvent | undefined {
		return this.byId.get(id);
	}

	bounds(): HistoryBounds {
		const count = this.liveCount();

		if (count === 0) {
			return { firstId: null, lastId: null, count: 0, chargedBytes: this.charged };
		}

		const first = this.events[this.start];
		const last = this.events[this.events.length - 1];

		return {
			firstId: first?.id ?? null,
			lastId: last?.id ?? null,
			count,
			chargedBytes: this.charged,
		};
	}

	readAfter(after: EventId | null, through: EventId, limit: number): readonly LogEvent[] {
		const out: LogEvent[] = [];
		const count = this.liveCount();

		for (let i = 0; i < count; i += 1) {
			const event = this.events[this.start + i];

			if (!event) break;

			if (after !== null && event.id <= after) continue;

			if (event.id > through) break;

			out.push(event);

			if (out.length >= limit) break;
		}

		return out;
	}

	private liveCount(): number {
		return this.events.length - this.start;
	}

	private overCapacity(): boolean {
		return this.liveCount() > this.maxEvents || this.charged > this.maxChargeBytes;
	}

	private compact(): void {
		if (this.start < 1024 || this.start < this.events.length / 2) return;

		this.events = this.events.slice(this.start);
		this.start = 0;
	}
}
