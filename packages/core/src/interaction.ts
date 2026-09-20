import type { CommandError, SessionCommand } from "./commands.ts";
import { FILTER_FIELDS, type FilterField } from "./commands.ts";
import { parseLevelField, parsePidField, prepareFilter } from "./filters.ts";
import type { FilterSpec } from "./types.ts";

export type InteractionState =
	| { focus: "list" }
	| { focus: "inspect" }
	| { focus: "help" }
	| {
			focus: "filters";
			field: FilterField;
			draft: { minLevel: string; tag: string; pid: string; packageName: string; text: string };
			error: CommandError | null;
	  };

export type InteractionSelection = Readonly<{
	tag: string | null;
	pid: number | null;
}>;

export const EMPTY_SELECTION: InteractionSelection = { tag: null, pid: null };

export type InteractionInput =
	| { kind: "key"; key: string; ctrl: boolean; shift: boolean }
	| { kind: "edit-field"; value: string };

export type InteractionResult = Readonly<{
	state: InteractionState;
	command: SessionCommand | null;
	quit: boolean;
}>;

export const LIST_FOCUS: InteractionState = { focus: "list" };

export const INSPECT_FOCUS: InteractionState = { focus: "inspect" };

export const HELP_FOCUS: InteractionState = { focus: "help" };

type FilterDraft = Readonly<{
	minLevel: string;
	tag: string;
	pid: string;
	packageName: string;
	text: string;
}>;

type CommitDraftResult = Readonly<{
	command: SessionCommand | null;
	error: CommandError | null;
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

function appendToDraft(
	state: Extract<InteractionState, { focus: "filters" }>,
	text: string,
): InteractionState {
	const current = state.draft[state.field];

	return {
		...state,
		error: null,
		draft: { ...state.draft, [state.field]: current + text },
	};
}

function backspaceDraft(state: Extract<InteractionState, { focus: "filters" }>): InteractionState {
	const current = state.draft[state.field];
	const next = [...current].slice(0, -1).join("");

	return {
		...state,
		error: null,
		draft: { ...state.draft, [state.field]: next },
	};
}

function openEditor(
	activeFilter: FilterSpec,
	field: FilterField,
): InteractionState {
	return {
		focus: "filters",
		field,
		draft: draftFromFilter(activeFilter),
		error: null,
	};
}

export function reduceInteraction(
	state: InteractionState,
	input: InteractionInput,
	activeFilter: FilterSpec,
	selection: InteractionSelection = EMPTY_SELECTION,
): InteractionResult {
	if (input.kind === "edit-field") {
		if (state.focus !== "filters") {
			return { state, command: null, quit: false };
		}

		return {
			state: {
				...state,
				error: null,
				draft: { ...state.draft, [state.field]: input.value },
			},
			command: null,
			quit: false,
		};
	}

	const { key, ctrl, shift } = input;

	if (ctrl && (key === "c" || key === "C")) {
		return { state, command: null, quit: true };
	}

	if (state.focus === "filters") {
		if (key === "escape") {
			return { state: LIST_FOCUS, command: null, quit: false };
		}

		if (key === "enter") {
			const onlyText = state.field === "text" && state.draft.minLevel === (activeFilter.minLevel ?? "ALL");
			const result = commitDraft(state.draft, activeFilter);

			if (result.error) {
				return { state: { ...state, error: result.error }, command: null, quit: false };
			}

			void onlyText;

			return { state: LIST_FOCUS, command: result.command, quit: false };
		}

		if (key === "tab") {
			return {
				state: { ...state, field: nextField(state.field, shift), error: null },
				command: null,
				quit: false,
			};
		}

		if (key === "backspace") {
			return { state: backspaceDraft(state), command: null, quit: false };
		}

		if (key.length === 1 && !ctrl) {
			return { state: appendToDraft(state, key), command: null, quit: false };
		}

		return { state, command: null, quit: false };
	}

	if (state.focus === "inspect" || state.focus === "help") {
		if (key === "escape" || key === "enter") {
			return { state: LIST_FOCUS, command: null, quit: false };
		}

		if (state.focus === "inspect" && key === "t" && selection.tag) {
			const spec: FilterSpec = { ...activeFilter, tag: selection.tag };
			const prepared = prepareFilter(spec);

			if (!prepared.ok) return { state, command: null, quit: false };

			return { state: LIST_FOCUS, command: { kind: "set-filter", filter: prepared.value.spec }, quit: false };
		}

		if (state.focus === "inspect" && key === "p" && selection.pid !== null) {
			const spec: FilterSpec = { ...activeFilter, pid: selection.pid };
			const prepared = prepareFilter(spec);

			if (!prepared.ok) return { state, command: null, quit: false };

			return { state: LIST_FOCUS, command: { kind: "set-filter", filter: prepared.value.spec }, quit: false };
		}

		if (key === "q") {
			return { state, command: null, quit: true };
		}

		if (key === "up" || key === "k") {
			return { state, command: { kind: "move", delta: -1 }, quit: false };
		}

		if (key === "down" || key === "j") {
			return { state, command: { kind: "move", delta: 1 }, quit: false };
		}

		if (key === "?") {
			return { state: state.focus === "help" ? LIST_FOCUS : HELP_FOCUS, command: null, quit: false };
		}

		return { state, command: null, quit: false };
	}

	if (key === "q") {
		return { state, command: null, quit: true };
	}

	if (key === "enter") {
		return { state: INSPECT_FOCUS, command: { kind: "request-package-attribution" }, quit: false };
	}

	if (key === "?") {
		return { state: HELP_FOCUS, command: null, quit: false };
	}

	if (key === "up" || key === "k") {
		return { state, command: { kind: "move", delta: -1 }, quit: false };
	}

	if (key === "down" || key === "j") {
		return { state, command: { kind: "move", delta: 1 }, quit: false };
	}

	if (key === "pageup" || (ctrl && (key === "u" || key === "U"))) {
		return { state, command: { kind: "page", delta: -1 }, quit: false };
	}

	if (key === "pagedown" || (ctrl && (key === "d" || key === "D"))) {
		return { state, command: { kind: "page", delta: 1 }, quit: false };
	}

	if (key === "home") {
		return { state, command: { kind: "oldest" }, quit: false };
	}

	if (key === "end" || key === "G") {
		return { state, command: { kind: "tail" }, quit: false };
	}

	if (key === "w" || key === "W") {
		return { state, command: { kind: "toggle-line-display" }, quit: false };
	}

	if (key === "m" || key === "M") {
		return { state, command: { kind: "toggle-search-mode" }, quit: false };
	}

	if (key === "/") {
		return { state: openEditor(activeFilter, "text"), command: null, quit: false };
	}

	if (key === "f") {
		return { state: openEditor(activeFilter, "minLevel"), command: null, quit: false };
	}

	return { state, command: null, quit: false };
}
