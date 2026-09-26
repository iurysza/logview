import { QUERY_KEYS } from "./query.ts";

/**
 * Fish-style completion for the one-line query editor.
 *
 * The engine or UI supplies candidate values, already ordered with the most
 * useful first. This module only decides what the word under the cursor could
 * become. It never scans events.
 */

export type QueryCandidates = Readonly<{
	tags: readonly string[];
	pids: readonly number[];
	packages: readonly string[];
}>;

export const EMPTY_CANDIDATES: QueryCandidates = { tags: [], pids: [], packages: [] };

export type QueryCompletion = Readonly<{
	/** Code-point offset where the replaced word starts. */
	start: number;
	/** Text that replaces the word from `start` to the cursor. */
	replacement: string;
	/** Characters shown as ghost text after the cursor. */
	ghost: string;
	/** Other values the word could take, best first, excluding `replacement`. */
	alternatives: readonly string[];
}>;

export const LEVEL_CANDIDATES = ["V", "D", "I", "W", "E", "F"] as const;

const MAX_ALTERNATIVES = 6;

/** Values that would need quotes are not offered; ghost text must be a plain suffix. */
function bareValues(values: readonly string[]): readonly string[] {
	return values.filter((value) => /^[^\s"]+$/.test(value));
}

function ranked(typed: string, values: readonly string[]): readonly string[] {
	const exact: string[] = [];
	const folded: string[] = [];
	const lower = typed.toLowerCase();

	for (const value of values) {
		if (value.length <= typed.length) continue;

		if (value.startsWith(typed)) exact.push(value);
		else if (value.toLowerCase().startsWith(lower)) folded.push(value);
	}

	return [...exact, ...folded];
}

function complete(start: number, prefix: string, typed: string, values: readonly string[]): QueryCompletion | null {
	const matches = ranked(typed, values);
	const best = matches[0];

	if (best === undefined) return null;

	const replacement = `${prefix}${best}`;
	const word = `${prefix}${typed}`;

	return {
		start,
		replacement,
		ghost: replacement.slice(word.length),
		alternatives: matches.slice(1, 1 + MAX_ALTERNATIVES),
	};
}

function valuesFor(key: string, candidates: QueryCandidates): readonly string[] | null {
	if (key === "level") return LEVEL_CANDIDATES;

	if (key === "tag") return bareValues(candidates.tags);

	if (key === "pid") return candidates.pids.map(String);

	if (key === "pkg") return bareValues(candidates.packages);

	return null;
}

/**
 * Suggests a completion for the word before `cursor`. Returns null when the
 * cursor is inside a word, the word is empty, or nothing matches.
 */
export function completeQuery(draft: string, cursor: number, candidates: QueryCandidates): QueryCompletion | null {
	const chars = [...draft];
	const at = Math.min(Math.max(cursor, 0), chars.length);
	const next = chars[at];

	if (next !== undefined && !/\s/.test(next)) return null;

	let start = at;

	while (start > 0 && !/\s/.test(chars[start - 1]!)) start -= 1;

	const word = chars.slice(start, at).join("");

	if (word.length === 0 || word.startsWith('"') || word.startsWith("~")) return null;

	const colon = word.indexOf(":");

	if (colon === -1) {
		const keys: string[] = [];

		for (const key of QUERY_KEYS) keys.push(`${key}:`);

		return complete(start, "", word, keys);
	}

	const key = word.slice(0, colon);
	const values = valuesFor(key, candidates);

	if (values === null) return null;

	const typed = word.slice(colon + 1);

	if (typed.length === 0) {
		const best = values[0];

		if (best === undefined) return null;

		return { start, replacement: `${key}:${best}`, ghost: best, alternatives: values.slice(1, 1 + MAX_ALTERNATIVES) };
	}

	return complete(start, `${key}:`, typed, values);
}

export type CompletedDraft = Readonly<{ draft: string; cursor: number }>;

/** Applies a completion. Returns the new draft and cursor. */
export function acceptCompletion(draft: string, cursor: number, completion: QueryCompletion): CompletedDraft {
	const chars = [...draft];
	const at = Math.min(Math.max(cursor, 0), chars.length);
	const replacement = [...completion.replacement];
	const next = [...chars.slice(0, completion.start), ...replacement, ...chars.slice(at)];

	return { draft: next.join(""), cursor: completion.start + replacement.length };
}
