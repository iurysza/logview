import type { FilterField } from "./commands.ts";
import { foldText, parseLevelField, parsePidField, prepareFilter } from "./filters.ts";
import type { FilterSpec, Result, SearchMode, TextSlice } from "./types.ts";
import { err, ok } from "./types.ts";

/**
 * Filter query language shared by the TUI `/` editor and `logview query`.
 *
 *   query = term*            (terms separated by whitespace)
 *   term  = key ":" value | ["~"] value
 *   key   = level | tag | pid | pkg   (lowercase)
 *   value = bare | '"' (char | \" | \\)* '"'
 *
 * Non-key terms are text. Text terms are joined with one space.
 * A `~` before the first text term (or as its own term) asks Jev: the text
 * becomes a natural-language query instead of a literal search. A `~` later
 * in the text is literal.
 */

export type ParsedQuery = Readonly<{ filter: FilterSpec; searchMode: SearchMode }>;

export type QueryError = Readonly<{
	kind: "invalid-filter";
	field: FilterField | "query";
	message: string;
	offset: number;
}>;

export const QUERY_KEYS = ["level", "tag", "pid", "pkg"] as const;

type QueryKey = (typeof QUERY_KEYS)[number];

const KEY_FIELD: Readonly<Record<QueryKey, FilterField>> = {
	level: "minLevel",
	tag: "tag",
	pid: "pid",
	pkg: "packageName",
};

type Token = Readonly<{ key: QueryKey | null; value: string; quoted: boolean; offset: number; semantic: boolean }>;

function isQueryKey(value: string): value is QueryKey {
	return value === "level" || value === "tag" || value === "pid" || value === "pkg";
}

function queryError(field: QueryError["field"], message: string, offset: number): Result<never, QueryError> {
	return err({ kind: "invalid-filter", field, message, offset });
}

function isSpace(char: string): boolean {
	return /\s/.test(char);
}

type Scanned = Readonly<{ value: string; quoted: boolean; end: number }>;

function scanValue(query: string, start: number): Result<Scanned, QueryError> {
	if (query[start] !== '"') {
		let end = start;

		while (end < query.length && !isSpace(query[end]!)) end += 1;

		return ok({ value: query.slice(start, end), quoted: false, end });
	}

	let value = "";
	let index = start + 1;

	while (index < query.length) {
		const char = query[index]!;

		if (char === "\\" && (query[index + 1] === '"' || query[index + 1] === "\\")) {
			value += query[index + 1];
			index += 2;
			continue;
		}

		if (char === '"') {
			const end = index + 1;

			if (end < query.length && !isSpace(query[end]!)) {
				return queryError("query", "closing quote must be followed by a space", end);
			}

			return ok({ value, quoted: true, end });
		}

		value += char;
		index += 1;
	}

	return queryError("query", "unterminated quote", start);
}

function tokenize(query: string): Result<readonly Token[], QueryError> {
	const tokens: Token[] = [];
	let index = 0;

	while (index < query.length) {
		if (isSpace(query[index]!)) {
			index += 1;
			continue;
		}

		const offset = index;
		const keyMatch = /^([a-z]+):/.exec(query.slice(index));
		const key = keyMatch && isQueryKey(keyMatch[1]!) ? keyMatch[1] : null;
		const semantic = key === null && query[index] === "~";
		let valueStart = key === null ? index : index + key.length + 1;

		if (semantic) valueStart += 1;

		if (semantic && (valueStart >= query.length || isSpace(query[valueStart]!))) {
			tokens.push({ key: null, value: "", quoted: false, offset, semantic: true });
			index = valueStart;
			continue;
		}

		const scanned = scanValue(query, valueStart);

		if (!scanned.ok) return scanned;

		tokens.push({ key, value: scanned.value.value, quoted: scanned.value.quoted, offset, semantic });
		index = scanned.value.end;
	}

	return ok(tokens);
}

/** Parses a query that may ask Jev with `~`. */
export function parseQuery(query: string): Result<ParsedQuery, QueryError> {
	const tokens = tokenize(query);

	if (!tokens.ok) return tokens;

	const seen = new Map<QueryKey, Token>();
	const textParts: string[] = [];
	let textOffset = 0;
	let semanticOffset: number | null = null;

	for (const token of tokens.value) {
		if (token.key === null) {
			if (token.semantic && textParts.length === 0 && semanticOffset === null) {
				semanticOffset = token.offset;
				textOffset = token.offset;

				if (token.value.length > 0 || token.quoted) textParts.push(token.value);

				continue;
			}

			if (textParts.length === 0 && semanticOffset === null) textOffset = token.offset;
			textParts.push(token.semantic ? `~${token.value}` : token.value);
			continue;
		}

		if (seen.has(token.key)) return queryError(KEY_FIELD[token.key], `${token.key}: appears more than once`, token.offset);

		if (token.value.length === 0 && !token.quoted) {
			return queryError(KEY_FIELD[token.key], `${token.key}: needs a value`, token.offset);
		}

		seen.set(token.key, token);
	}

	const levelToken = seen.get("level");
	const level = parseLevelField(levelToken?.value ?? "");

	if (!level.ok) return queryError("minLevel", level.error.message, levelToken?.offset ?? 0);

	const pidToken = seen.get("pid");
	const pid = parsePidField(pidToken?.value ?? "");

	if (!pid.ok) return queryError("pid", pid.error.message, pidToken?.offset ?? 0);

	const text = textParts.join(" ");

	if (semanticOffset !== null && text.length === 0) {
		return queryError("text", "~ needs a question for Jev", semanticOffset);
	}

	const prepared = prepareFilter({
		minLevel: level.value,
		tag: seen.get("tag")?.value ?? null,
		pid: pid.value,
		packageName: seen.get("pkg")?.value ?? null,
		text,
	});

	if (!prepared.ok) {
		const field = prepared.error.field ?? "query";
		const key = QUERY_KEYS.find((candidate) => KEY_FIELD[candidate] === field);
		const offset = key === undefined ? textOffset : (seen.get(key)?.offset ?? 0);

		return queryError(field, prepared.error.message, offset);
	}

	return ok({ filter: prepared.value.spec, searchMode: semanticOffset === null ? "text" : "jev" });
}

/** Parses a literal filter query. A Jev query (`~`) is rejected. */
export function parseFilterQuery(query: string): Result<FilterSpec, QueryError> {
	const parsed = parseQuery(query);

	if (!parsed.ok) return parsed;

	if (parsed.value.searchMode === "jev") {
		return queryError("text", "~ asks Jev, which this command does not support", query.indexOf("~"));
	}

	return ok(parsed.value.filter);
}

function quote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function formatValue(value: string): string {
	return /^[^\s"]+$/.test(value) ? value : quote(value);
}

function looksLikeKey(word: string): boolean {
	const match = /^([a-z]+):/.exec(word);

	return match !== null && isQueryKey(match[1]!);
}

function formatSemanticText(text: string): string {
	const words = text.split(" ");
	const bare = /^[^\s"]+( [^\s"]+)*$/.test(text) && !words.some(looksLikeKey);

	return bare ? text : quote(text);
}

/** Literal text that starts with `~` is quoted so it does not ask Jev. */
function formatText(text: string): string {
	return text.startsWith("~") ? quote(text) : formatSemanticText(text);
}

/** Canonical query text. Jev queries put `~` before the text. */
export function formatQuery(spec: FilterSpec, searchMode: SearchMode): string {
	const literal = formatFilterQuery({ ...spec, text: "" });

	if (spec.text.length === 0) return literal;

	const text = searchMode === "jev" ? `~${formatSemanticText(spec.text)}` : formatText(spec.text);

	return literal.length === 0 ? text : `${literal} ${text}`;
}

export function formatFilterQuery(spec: FilterSpec): string {
	const terms: string[] = [];

	if (spec.minLevel !== null) terms.push(`level:${spec.minLevel}`);

	if (spec.tag !== null) terms.push(`tag:${formatValue(spec.tag)}`);

	if (spec.pid !== null) terms.push(`pid:${spec.pid}`);

	if (spec.packageName != null) terms.push(`pkg:${formatValue(spec.packageName)}`);

	if (spec.text.length > 0) terms.push(formatText(spec.text));

	return terms.join(" ");
}

/**
 * Ranges in `text` that the text filter matches, for highlighting. Returns no
 * ranges when case folding changes the string length, so offsets stay honest.
 */
export function textMatchRanges(text: string, spec: FilterSpec): readonly TextSlice[] {
	if (spec.text.length === 0) return [];

	const haystack = foldText(text);
	const needle = foldText(spec.text);

	if (haystack.length !== text.length || needle.length === 0) return [];

	const ranges: TextSlice[] = [];
	let from = haystack.indexOf(needle);

	while (from !== -1) {
		ranges.push({ start: from, end: from + needle.length });
		from = haystack.indexOf(needle, from + needle.length);
	}

	return ranges;
}
