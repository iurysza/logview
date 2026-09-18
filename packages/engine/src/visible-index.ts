import type { EventId } from "@logview/core";
import { EMPTY_LOCATION, type Location } from "@logview/core";

export interface VisibleIndex {
	readonly size: number;
	append(ids: readonly EventId[]): void;
	insert(id: EventId): void;
	remove(id: EventId): boolean;
	pruneBefore(firstRetainedId: EventId | null): void;
	locate(id: EventId | null): Location;
	at(rank: number): EventId | null;
	window(startRank: number, count: number): readonly EventId[];
}

export class VisibleIndexStore implements VisibleIndex {
	private ids: EventId[] = [];
	private start = 0;

	get size(): number {
		return this.ids.length - this.start;
	}

	append(ids: readonly EventId[]): void {
		for (const id of ids) {
			const last = this.at(this.size - 1);

			if (last !== null && id <= last) {
				continue;
			}

			this.ids.push(id);
		}
	}

	insert(id: EventId): void {
		const location = this.locate(id);

		if (location.exactRank !== null) return;

		const rank = location.nextRank === null ? this.size : location.nextRank;
		this.ids.splice(this.start + rank, 0, id);
	}

	remove(id: EventId): boolean {
		const location = this.locate(id);

		if (location.exactRank === null) return false;

		this.ids.splice(this.start + location.exactRank, 1);

		return true;
	}

	pruneBefore(firstRetainedId: EventId | null): void {
		if (firstRetainedId === null) {
			this.start = this.ids.length;
			this.compact();

			return;
		}

		while (this.size > 0) {
			const first = this.at(0);

			if (first === null || first >= firstRetainedId) break;

			this.start += 1;
		}

		this.compact();
	}

	locate(id: EventId | null): Location {
		if (id === null || this.size === 0) return EMPTY_LOCATION;

		let lo = 0;
		let hi = this.size;

		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const value = this.at(mid);

			if (value === null || value < id) lo = mid + 1;
			else hi = mid;
		}

		if (lo < this.size && this.at(lo) === id) {
			return {
				exactRank: lo,
				nextRank: lo + 1 < this.size ? lo + 1 : null,
				previousRank: lo > 0 ? lo - 1 : null,
			};
		}

		return {
			exactRank: null,
			nextRank: lo < this.size ? lo : null,
			previousRank: lo > 0 ? lo - 1 : null,
		};
	}

	at(rank: number): EventId | null {
		if (rank < 0 || rank >= this.size) return null;

		return this.ids[this.start + rank] ?? null;
	}

	window(startRank: number, count: number): readonly EventId[] {
		const out: EventId[] = [];

		for (let i = 0; i < count; i += 1) {
			const id = this.at(startRank + i);

			if (id === null) break;

			out.push(id);
		}

		return out;
	}

	snapshotIds(): readonly EventId[] {
		return this.window(0, this.size);
	}

	private compact(): void {
		if (this.start < 1024 || this.start < this.ids.length / 2) return;

		this.ids = this.ids.slice(this.start);
		this.start = 0;
	}
}
