import type { CommandError, SessionCommand } from "./commands.ts";
import { FILTER_FIELDS, type FilterField } from "./commands.ts";
import { parseLevelField, parsePidField, prepareFilter } from "./filters.ts";
import type { FilterSpec } from "./types.ts";

export type InteractionState =
	| { focus: "list" }
	| {
			focus: "filters";
			field: FilterField;
			draft: { minLevel: string; tag: string; pid: string; text: string };
			error: CommandError | null;
	  };

export type InteractionInput =
	| { kind: "key"; key: string; ctrl: boolean; shift: boolean }
	| { kind: "edit-field"; value: string };

export type InteractionResult = Readonly<{
	state: InteractionState;
	command: SessionCommand | null;
	quit: boolean;
}>;

export const LIST_FOCUS: InteractionState = { focus: "list" };

type FilterDraft = Readonly<{
	minLevel: string;
	tag: string;
	pid: string;
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

	if (key === "q") {
		return { state, command: null, quit: true };
	}

	if (key === "up" || key === "k") {
		return { state, command: { kind: "move", delta: -1 }, quit: false };
	}

	if (key === "down" || key === "j") {
		return { state, command: { kind: "move", delta: 1 }, quit: false };
	}

	if (key === "pageup") {
		return { state, command: { kind: "page", delta: -1 }, quit: false };
	}

	if (key === "pagedown") {
		return { state, command: { kind: "page", delta: 1 }, quit: false };
	}

	if (key === "home") {
		return { state, command: { kind: "oldest" }, quit: false };
	}

	if (key === "end" || key === "G") {
		return { state, command: { kind: "tail" }, quit: false };
	}

	if (key === "/") {
		return { state: openEditor(activeFilter, "text"), command: null, quit: false };
	}

	if (key === "f") {
		return { state: openEditor(activeFilter, "minLevel"), command: null, quit: false };
	}

	return { state, command: null, quit: false };
}
