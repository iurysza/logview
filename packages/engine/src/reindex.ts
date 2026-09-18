import { matches, type EventId, type LogEvent, type PreparedFilter } from "@logview/core";
import type { History } from "./history.ts";
import { VisibleIndexStore } from "./visible-index.ts";

export type FilterMatcher = (event: LogEvent) => boolean;

export class FilterJob {
	readonly prefix = new VisibleIndexStore();
	readonly tail = new VisibleIndexStore();
	scanAfter: EventId | null = null;
	done = false;

	constructor(
		readonly revision: number,
		readonly prepared: PreparedFilter,
		readonly highWater: EventId | null,
		private readonly matcher: FilterMatcher = (event) => matches(event, prepared),
	) {}

	scanSlice(history: History, maxLines: number): { done: boolean; matchedIds: readonly EventId[] } {
		if (this.done) return { done: true, matchedIds: [] };

		if (this.highWater === null) {
			this.done = true;

			return { done: true, matchedIds: [] };
		}

		const batch = history.readAfter(this.scanAfter, this.highWater, maxLines);

		if (batch.length === 0) {
			this.done = true;

			return { done: true, matchedIds: [] };
		}

		const matchedIds: EventId[] = [];

		for (const event of batch) {
			if (this.matcher(event)) {
				this.prefix.append([event.id]);
				matchedIds.push(event.id);
			}

			this.scanAfter = event.id;
		}

		if (this.scanAfter === this.highWater) {
			this.done = true;

			return { done: true, matchedIds };
		}

		return { done: false, matchedIds };
	}

	appendArrival(id: EventId, matchesPending: boolean): void {
		if (this.highWater !== null && id <= this.highWater) return;

		if (matchesPending) this.tail.append([id]);
	}

	publish(firstRetainedId: EventId | null): VisibleIndexStore {
		this.prefix.pruneBefore(firstRetainedId);
		this.tail.pruneBefore(firstRetainedId);
		const next = new VisibleIndexStore();
		next.append(this.prefix.snapshotIds());
		next.append(this.tail.snapshotIds());

		return next;
	}
}
