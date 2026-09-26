/**
 * Shared filter contract. The CLI (`logcayo query`) and the TUI (`/` editor)
 * must return exactly these event IDs for each query against FIXTURE.
 * IDs are engine event IDs from an instant replay. Continuation lines belong
 * to their parent event.
 */
export const FILTER_CONTRACT_FIXTURE = "tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl";

export type FilterContractCase = Readonly<{
	query: string;
	canonical: string;
	expectedIds: readonly number[];
}>;

export const FILTER_CONTRACT_CASES: readonly FilterContractCase[] = [
	{ query: "", canonical: "", expectedIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
	{ query: "level:w", canonical: "level:W", expectedIds: [6, 8, 9, 11] },
	{ query: "tag:Database", canonical: "tag:Database", expectedIds: [4, 5, 6, 7] },
	{ query: "tag:Database lock", canonical: "tag:Database lock", expectedIds: [6] },
	{ query: "pid:1", canonical: "pid:1", expectedIds: [11] },
	{ query: "tag:logview-demo level:E", canonical: "level:E tag:logview-demo", expectedIds: [8] },
	{ query: "store.java", canonical: "store.java", expectedIds: [6] },
	{ query: "LOCK", canonical: "LOCK", expectedIds: [6, 13] },
	{ query: '"lock timeout"', canonical: "lock timeout", expectedIds: [6] },
	{ query: "日本語", canonical: "日本語", expectedIds: [15] },
	{ query: "tag:Nope", canonical: "tag:Nope", expectedIds: [] },
];

export const INVALID_FILTER_QUERIES: readonly Readonly<{ query: string; field: string }>[] = [
	{ query: "pid:0", field: "pid" },
	{ query: "level:Q", field: "minLevel" },
	{ query: "tag:a tag:b", field: "tag" },
	{ query: '"open', field: "query" },
];
