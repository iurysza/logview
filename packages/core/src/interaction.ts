import type { CommandError, SessionCommand } from "./commands.ts";
import { FILTER_FIELDS, type FilterField } from "./commands.ts";
import { parseLevelField, parsePidField, prepareFilter } from "./filters.ts";
import { acceptCompletion, completeQuery, EMPTY_CANDIDATES, type QueryCandidates } from "./completion.ts";
import { formatFilterQuery, formatQuery, parseQuery, type QueryError } from "./query.ts";
import { EMPTY_FILTER, type FilterSpec, type SearchMode } from "./types.ts";

const MEMORY_LIMIT = 20;

type InteractionMemory = Readonly<{
	history: readonly string[];
	undo: readonly FilterSpec[];
}>;

type InteractionFocus =
	| { focus: "list" }
	| { focus: "inspect" }
	| { focus: "help" }
	| {
			focus: "filters";
			field: FilterField;
			draft: FilterDraft;
			error: CommandError | null;
	  }
	| {
			focus: "query";
			draft: string;
			cursor: number;
			error: QueryError | null;
			origin: FilterSpec;
			originMode: SearchMode;
			historyIndex: number | null;
	  };

export type InteractionState = InteractionFocus & InteractionMemory;

export type InteractionSelection = Readonly<{
	tag: string | null;
	pid: number | null;
}>;

export const EMPTY_SELECTION: InteractionSelection = { tag: null, pid: null };

export type InteractionInput =
	| { kind: "key"; key: string; ctrl: boolean; shift: boolean }
	| { kind: "edit-field"; value: string };

export type InteractionEffect = Readonly<{ kind: "copy"; text: string }>;

/** What the query editor can offer: Jev availability and completion values. */
export type QueryContext = Readonly<{
	semanticAvailable: boolean;
	candidates: QueryCandidates;
}>;

export const TEXT_ONLY_CONTEXT: QueryContext = { semanticAvailable: false, candidates: EMPTY_CANDIDATES };

const JEV_UNAVAILABLE = "Jev is off. Start with --semantic and TYPESAFE_API_KEY";

export type InteractionResult = Readonly<{
	state: InteractionState;
	command: SessionCommand | null;
	quit: boolean;
	effect: InteractionEffect | null;
}>;

const EMPTY_MEMORY: InteractionMemory = { history: [], undo: [] };

export const LIST_FOCUS: InteractionState = { focus: "list", ...EMPTY_MEMORY };

export const INSPECT_FOCUS: InteractionState = { focus: "inspect", ...EMPTY_MEMORY };

export const HELP_FOCUS: InteractionState = { focus: "help", ...EMPTY_MEMORY };

type FilterDraft = Readonly<{
	minLevel: string;
	tag: string;
	pid: string;
	packageName: string;
	text: string;
}>;

type QueryState = Extract<InteractionState, { focus: "query" }>;

type FiltersState = Extract<InteractionState, { focus: "filters" }>;

type CommitDraftResult = Readonly<{
	command: SessionCommand | null;
	error: CommandError | null;
}>;

type FilterCommit = Readonly<{
	undo: readonly FilterSpec[];
	command: SessionCommand | null;
}>;

function draftFromFilter(filter: FilterSpec): FilterDraft {
	return {
		minLevel: filter.minLevel ?? "ALL",
		tag: filter.tag ?? "",
		pid: filter.pid === null ? "" : String(filter.pid),
		packageName: filter.packageName ?? "",
		text: filter.text,
	};
}

function nextField(field: FilterField, reverse: boolean): FilterField {
	const index = FILTER_FIELDS.indexOf(field);
	const delta = reverse ? -1 : 1;
	const next = (index + delta + FILTER_FIELDS.length) % FILTER_FIELDS.length;

	return FILTER_FIELDS[next]!;
}

function sameFilter(left: FilterSpec, right: FilterSpec): boolean {
	return (
		left.minLevel === right.minLevel &&
		left.tag === right.tag &&
		left.pid === right.pid &&
		left.packageName === right.packageName &&
		left.text === right.text
	);
}

function rememberQuery(history: readonly string[], query: string): readonly string[] {
	const next = [query, ...history];

	return next.length <= MEMORY_LIMIT ? next : next.slice(0, MEMORY_LIMIT);
}

function rememberFilter(undo: readonly FilterSpec[], filter: FilterSpec): readonly FilterSpec[] {
	const next = [filter, ...undo];

	return next.length <= MEMORY_LIMIT ? next : next.slice(0, MEMORY_LIMIT);
}

function commitFilter(undo: readonly FilterSpec[], active: FilterSpec, next: FilterSpec): FilterCommit {
	if (sameFilter(active, next)) return { undo, command: null };

	return { undo: rememberFilter(undo, active), command: { kind: "set-filter", filter: next } };
}

function done(
	state: InteractionState,
	command: SessionCommand | null,
	quit = false,
	effect: InteractionEffect | null = null,
): InteractionResult {
	return { state, command, quit, effect };
}

function showList(state: InteractionState, undo: readonly FilterSpec[] = state.undo): InteractionState {
	return { focus: "list", history: state.history, undo };
}

function commitDraft(
	draft: FilterDraft,
	activeFilter: FilterSpec,
	fieldLock?: FilterField,
): CommitDraftResult {
	const level = parseLevelField(draft.minLevel);

	if (!level.ok) return { command: null, error: level.error };
	const pid = parsePidField(draft.pid);

	if (!pid.ok) return { command: null, error: pid.error };

	const spec: FilterSpec = {
		minLevel: fieldLock && fieldLock !== "minLevel" ? activeFilter.minLevel : level.value,
		tag: fieldLock && fieldLock !== "tag" ? activeFilter.tag : draft.tag.trim() === "" ? null : draft.tag.trim(),
		pid: fieldLock && fieldLock !== "pid" ? activeFilter.pid : pid.value,
		packageName:
			fieldLock && fieldLock !== "packageName"
				? activeFilter.packageName
				: draft.packageName.trim() === ""
					? null
					: draft.packageName.trim(),
		text: fieldLock && fieldLock !== "text" ? activeFilter.text : draft.text,
	};

	const prepared = prepareFilter(spec);

	if (!prepared.ok) return { command: null, error: prepared.error };

	return { command: { kind: "set-filter", filter: prepared.value.spec }, error: null };
}

function appendToDraft(state: FiltersState, text: string): InteractionState {
	const current = state.draft[state.field];

	return {
		...state,
		error: null,
		draft: { ...state.draft, [state.field]: current + text },
	};
}

function backspaceDraft(state: FiltersState): InteractionState {
	const current = state.draft[state.field];
	const next = [...current].slice(0, -1).join("");

	return {
		...state,
		error: null,
		draft: { ...state.draft, [state.field]: next },
	};
}

function openEditor(state: InteractionState, activeFilter: FilterSpec, field: FilterField): InteractionState {
	return {
		focus: "filters",
		field,
		draft: draftFromFilter(activeFilter),
		error: null,
		history: state.history,
		undo: state.undo,
	};
}

function openQuery(state: InteractionState, activeFilter: FilterSpec, searchMode: SearchMode): InteractionState {
	const draft = formatQuery(activeFilter, searchMode);

	return {
		focus: "query",
		draft,
		cursor: [...draft].length,
		error: null,
		origin: activeFilter,
		originMode: searchMode,
		historyIndex: null,
		history: state.history,
		undo: state.undo,
	};
}

type QueryEnv = Readonly<{
	activeFilter: FilterSpec;
	searchMode: SearchMode;
	context: QueryContext;
}>;

function parseDraft(draft: string, context: QueryContext): ReturnType<typeof parseQuery> {
	const parsed = parseQuery(draft);

	if (parsed.ok && parsed.value.searchMode === "jev" && !context.semanticAvailable) {
		return { ok: false, error: { kind: "invalid-filter", field: "text", message: JEV_UNAVAILABLE, offset: draft.indexOf("~") } };
	}

	return parsed;
}

function sameQuery(env: QueryEnv, filter: FilterSpec, searchMode: SearchMode): boolean {
	return sameFilter(env.activeFilter, filter) && (filter.text.length === 0 || env.searchMode === searchMode);
}

function setFilter(filter: FilterSpec, searchMode: SearchMode, context: QueryContext): SessionCommand {
	return context.semanticAvailable ? { kind: "set-filter", filter, searchMode } : { kind: "set-filter", filter };
}

/**
 * Text queries apply on every edit. Jev queries (`~`) wait for Enter because
 * each apply is a paid classification.
 */
function applyQueryDraft(
	state: QueryState,
	draft: string,
	cursor: number,
	historyIndex: number | null,
	env: QueryEnv,
): InteractionResult {
	const parsed = parseDraft(draft, env.context);

	const next: QueryState = { ...state, draft, cursor, error: parsed.ok ? null : parsed.error, historyIndex };

	if (!parsed.ok || parsed.value.searchMode === "jev") return done(next, null);

	if (sameQuery(env, parsed.value.filter, "text")) return done(next, null);

	return done(next, setFilter(parsed.value.filter, "text", env.context));
}

function editQuery(state: QueryState, draft: string, cursor: number, env: QueryEnv): InteractionResult {
	return applyQueryDraft(state, draft, cursor, null, env);
}

function commitQuery(state: QueryState, env: QueryEnv): InteractionResult {
	const parsed = parseDraft(state.draft, env.context);

	if (!parsed.ok) return done({ ...state, error: parsed.error }, null);

	const { filter, searchMode } = parsed.value;
	const undo = sameFilter(state.origin, filter) ? state.undo : rememberFilter(state.undo, state.origin);
	const command = sameQuery(env, filter, searchMode) ? null : setFilter(filter, searchMode, env.context);

	return done({ focus: "list", history: rememberQuery(state.history, formatQuery(filter, searchMode)), undo }, command);
}

function cancelQuery(state: QueryState, env: QueryEnv): InteractionResult {
	const command = sameQuery(env, state.origin, state.originMode) ? null : setFilter(state.origin, state.originMode, env.context);

	return done(showList(state), command);
}

function recallQuery(state: QueryState, env: QueryEnv, older: boolean): InteractionResult {
	const history = state.history;

	if (history.length === 0) return done(state, null);

	const index = older
		? state.historyIndex === null
			? 0
			: Math.min(state.historyIndex + 1, history.length - 1)
		: state.historyIndex === null || state.historyIndex === 0
			? state.historyIndex
			: state.historyIndex - 1;

	if (index === null || index === state.historyIndex) return done(state, null);

	const draft = history[index] ?? "";

	return applyQueryDraft(state, draft, [...draft].length, index, env);
}

function insertQuery(state: QueryState, text: string, env: QueryEnv): InteractionResult {
	const chars = [...state.draft];
	const cursor = Math.min(Math.max(state.cursor, 0), chars.length);

	chars.splice(cursor, 0, text);

	return editQuery(state, chars.join(""), cursor + 1, env);
}

function backspaceQuery(state: QueryState, env: QueryEnv): InteractionResult {
	const chars = [...state.draft];
	const cursor = Math.min(Math.max(state.cursor, 0), chars.length);

	if (cursor === 0) return done(state, null);

	chars.splice(cursor - 1, 1);

	return editQuery(state, chars.join(""), cursor - 1, env);
}

function moveQueryCursor(state: QueryState, cursor: number): InteractionResult {
	const length = [...state.draft].length;

	return done({ ...state, cursor: Math.min(Math.max(cursor, 0), length) }, null);
}

/** Tab, or Right at the end of the line, accepts the ghost suggestion. */
function acceptQuerySuggestion(state: QueryState, env: QueryEnv): InteractionResult | null {
	const completion = completeQuery(state.draft, state.cursor, env.context.candidates);

	if (completion === null) return null;

	const accepted = acceptCompletion(state.draft, state.cursor, completion);

	return editQuery(state, accepted.draft, accepted.cursor, env);
}

function reduceQuery(state: QueryState, key: string, ctrl: boolean, env: QueryEnv): InteractionResult {
	if (key === "escape") return cancelQuery(state, env);

	if (key === "enter") return commitQuery(state, env);

	if (key === "tab") return acceptQuerySuggestion(state, env) ?? done(state, null);

	if (key === "up") return recallQuery(state, env, true);

	if (key === "down") return recallQuery(state, env, false);

	if (key === "left") return moveQueryCursor(state, state.cursor - 1);

	if (key === "right") {
		if (state.cursor >= [...state.draft].length) return acceptQuerySuggestion(state, env) ?? done(state, null);

		return moveQueryCursor(state, state.cursor + 1);
	}

	if (key === "home") return moveQueryCursor(state, 0);

	if (key === "end") return moveQueryCursor(state, [...state.draft].length);

	if (key === "backspace") return backspaceQuery(state, env);

	if (key.length === 1 && !ctrl) return insertQuery(state, key, env);

	return done(state, null);
}

function reduceFilters(state: FiltersState, key: string, ctrl: boolean, shift: boolean, activeFilter: FilterSpec): InteractionResult {
	if (key === "escape") return done(showList(state), null);

	if (key === "enter") {
		const result = commitDraft(state.draft, activeFilter);

		if (result.error || result.command === null || result.command.kind !== "set-filter") {
			return done({ ...state, error: result.error }, null);
		}

		const committed = commitFilter(state.undo, activeFilter, result.command.filter);

		return done(showList(state, committed.undo), committed.command);
	}

	if (key === "tab") {
		return done({ ...state, field: nextField(state.field, shift), error: null }, null);
	}

	if (key === "backspace") return done(backspaceDraft(state), null);

	if (key.length === 1 && !ctrl) return done(appendToDraft(state, key), null);

	return done(state, null);
}

function reduceOverlay(
	state: InteractionState,
	key: string,
	activeFilter: FilterSpec,
	selection: InteractionSelection,
): InteractionResult {
	if (key === "escape" || key === "enter") return done(showList(state), null);

	if (state.focus === "inspect" && key === "t" && selection.tag) {
		const prepared = prepareFilter({ ...activeFilter, tag: selection.tag });

		if (!prepared.ok) return done(state, null);

		const committed = commitFilter(state.undo, activeFilter, prepared.value.spec);

		return done(showList(state, committed.undo), committed.command);
	}

	if (state.focus === "inspect" && key === "p" && selection.pid !== null) {
		const prepared = prepareFilter({ ...activeFilter, pid: selection.pid });

		if (!prepared.ok) return done(state, null);

		const committed = commitFilter(state.undo, activeFilter, prepared.value.spec);

		return done(showList(state, committed.undo), committed.command);
	}

	if (key === "q") return done(state, null, true);

	if (key === "up" || key === "k") return done(state, { kind: "move", delta: -1 });

	if (key === "down" || key === "j") return done(state, { kind: "move", delta: 1 });

	if (key === "?") {
		return done(state.focus === "help" ? showList(state) : { focus: "help", history: state.history, undo: state.undo }, null);
	}

	return done(state, null);
}

function reduceList(
	state: InteractionState,
	key: string,
	ctrl: boolean,
	activeFilter: FilterSpec,
	searchMode: SearchMode,
): InteractionResult {
	if (key === "q") return done(state, null, true);

	if (key === "enter") {
		return done({ focus: "inspect", history: state.history, undo: state.undo }, { kind: "request-package-attribution" });
	}

	if (key === "?") return done({ focus: "help", history: state.history, undo: state.undo }, null);

	if (key === "up" || key === "k") return done(state, { kind: "move", delta: -1 });

	if (key === "down" || key === "j") return done(state, { kind: "move", delta: 1 });

	if (key === "pageup" || (ctrl && (key === "u" || key === "U"))) return done(state, { kind: "page", delta: -1 });

	if (key === "pagedown" || (ctrl && (key === "d" || key === "D"))) return done(state, { kind: "page", delta: 1 });

	if (key === "home") return done(state, { kind: "oldest" });

	if (key === "end" || key === "G") return done(state, { kind: "tail" });

	if (key === "w" || key === "W") return done(state, { kind: "toggle-line-display" });

	if (key === "m" || key === "M") return done(state, { kind: "toggle-search-mode" });

	if (!ctrl && (key === "x" || key === "X")) {
		const committed = commitFilter(state.undo, activeFilter, EMPTY_FILTER);

		return done({ ...state, undo: committed.undo }, committed.command);
	}

	if (!ctrl && (key === "u" || key === "U")) {
		const restored = state.undo[0];

		if (restored === undefined) return done(state, null);

		const undo = state.undo.slice(1);

		if (sameFilter(activeFilter, restored)) return done({ ...state, undo }, null);

		return done({ ...state, undo }, { kind: "set-filter", filter: restored });
	}

	if (!ctrl && (key === "c" || key === "C")) {
		return done(state, null, false, { kind: "copy", text: formatQuery(activeFilter, searchMode) });
	}

	if (key === "/") return done(openQuery(state, activeFilter, searchMode), null);

	if (key === "f") return done(openEditor(state, activeFilter, "minLevel"), null);

	return done(state, null);
}

export function reduceInteraction(
	state: InteractionState,
	input: InteractionInput,
	activeFilter: FilterSpec,
	selection: InteractionSelection = EMPTY_SELECTION,
	searchMode: SearchMode = "text",
	context: QueryContext = TEXT_ONLY_CONTEXT,
): InteractionResult {
	const env: QueryEnv = { activeFilter, searchMode, context };

	if (input.kind === "edit-field") {
		if (state.focus === "filters") {
			return done({ ...state, error: null, draft: { ...state.draft, [state.field]: input.value } }, null);
		}

		if (state.focus === "query") return editQuery(state, input.value, [...input.value].length, env);

		return done(state, null);
	}

	const { key, ctrl, shift } = input;

	if (ctrl && (key === "c" || key === "C")) return done(state, null, true);

	if (state.focus === "query") return reduceQuery(state, key, ctrl, env);

	if (state.focus === "filters") return reduceFilters(state, key, ctrl, shift, activeFilter);

	if (state.focus === "inspect" || state.focus === "help") return reduceOverlay(state, key, activeFilter, selection);

	return reduceList(state, key, ctrl, activeFilter, searchMode);
}
