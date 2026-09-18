import { matches, type EventId, type PreparedFilter } from "@logview/core";
import type { History } from "./history.ts";
import { VisibleIndexStore } from "./visible-index.ts";

export class FilterJob {
	readonly prefix = new VisibleIndexStore();
	readonly tail = new VisibleIndexStore();
	scanAfter: EventId | null = null;
	done = false;

	constructor(
		readonly revision: number,
		readonly prepared: PreparedFilter,
		readonly highWater: EventId | null,
	) {}

	scanSlice(history: History, maxLines: number): boolean {
		if (this.done) return true;

		if (this.highWater === null) {
			this.done = true;

			return true;
		}

		const batch = history.readAfter(this.scanAfter, this.highWater, maxLines);

		if (batch.length === 0) {
			this.done = true;

			return true;
		}

		for (const event of batch) {
			if (matches(event, this.prepared)) this.prefix.append([event.id]);
			this.scanAfter = event.id;
		}

		if (this.scanAfter === this.highWater) {
			this.done = true;

			return true;
		}

		return false;
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
