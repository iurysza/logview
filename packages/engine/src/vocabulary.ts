import { EMPTY_CANDIDATES, tagText, type LogEvent, type QueryCandidates } from "@logview/core";

const MAX_DISTINCT = 2_000;

const MAX_OFFERED = 200;

function byCount<T>(counts: ReadonlyMap<T, number>): T[] {
	const entries = [...counts.entries()];

	entries.sort((left, right) => right[1] - left[1]);

	const out: T[] = [];

	for (const [value] of entries.slice(0, MAX_OFFERED)) out.push(value);

	return out;
}

/**
 * Counts tags and PIDs as events arrive, so completion never scans history.
 * Counts cover every admitted event, including evicted ones. Distinct values
 * are capped; values seen after the cap are ignored.
 */
export class QueryVocabulary {
	private readonly tags = new Map<string, number>();
	private readonly pids = new Map<number, number>();
	private packages: readonly string[] = [];
	private cached: QueryCandidates = EMPTY_CANDIDATES;
	private dirty = false;

	add(event: LogEvent): void {
		if (event.metadata === null) return;

		const tag = tagText(event.rawText, event.metadata.tag);

		if (tag.length > 0) this.bump(this.tags, tag);

		this.bump(this.pids, event.metadata.pid);
	}

	setPackages(packages: readonly string[]): void {
		this.packages = [...new Set(packages)].sort();
		this.dirty = true;
	}

	candidates(): QueryCandidates {
		if (!this.dirty) return this.cached;

		this.cached = { tags: byCount(this.tags), pids: byCount(this.pids), packages: this.packages };
		this.dirty = false;

		return this.cached;
	}

	private bump<T>(counts: Map<T, number>, value: T): void {
		const current = counts.get(value);

		if (current === undefined && counts.size >= MAX_DISTINCT) return;

		counts.set(value, (current ?? 0) + 1);
		this.dirty = true;
	}
}
