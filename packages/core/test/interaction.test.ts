import { describe, expect, test } from "bun:test";
import { EMPTY_FILTER, LIST_FOCUS, reduceInteraction, type FilterSpec, type InteractionState, type SearchMode } from "@logview/core";

const pressKey = (key: string) => ({ kind: "key" as const, key, ctrl: false, shift: false });

function applyKey(state: InteractionState, key: string, active: FilterSpec, searchMode: SearchMode = "text") {
	const result = reduceInteraction(state, pressKey(key), active, { tag: null, pid: null }, searchMode);
	const next = result.command?.kind === "set-filter" ? result.command.filter : active;

	return { state: result.state, active: next, command: result.command, effect: result.effect };
}

describe("reduceInteraction", () => {
	test("/ then text then Enter produces a text-filter command", () => {
		let state = LIST_FOCUS;
		const slash = reduceInteraction(state, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);
		state = slash.state;
		expect(state.focus).toBe("query");

		if (state.focus !== "query") return;
		expect(state.draft).toBe("");
		const typed = reduceInteraction(state, { kind: "edit-field", value: "database" }, EMPTY_FILTER);
		expect(typed.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, packageName: null, text: "database" },
		});

		const enter = reduceInteraction(
			typed.state,
			{ kind: "key", key: "enter", ctrl: false, shift: false },
			{ minLevel: null, tag: null, pid: null, packageName: null, text: "database" },
		);

		expect(enter.state.focus).toBe("list");
		expect(enter.command).toBeNull();
		expect(enter.quit).toBe(false);

		if (enter.state.focus !== "list") return;
		expect(enter.state.history).toEqual(["database"]);
	});

	test("Escape produces no command", () => {
		const open = reduceInteraction(LIST_FOCUS, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);
		const escape = reduceInteraction(open.state, { kind: "key", key: "escape", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(escape.command).toBeNull();
		expect(escape.state).toEqual(LIST_FOCUS);
	});

	test("q is text in an editor and list shortcuts are suppressed", () => {
		const open = reduceInteraction(LIST_FOCUS, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);
		const q = reduceInteraction(open.state, { kind: "key", key: "q", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(q.quit).toBe(false);
		expect(q.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, packageName: null, text: "q" },
		});

		if (q.state.focus !== "query") throw new Error("expected query editor");
		expect(q.state.draft).toBe("q");
		const up = reduceInteraction(q.state, { kind: "key", key: "up", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(up.command).toBeNull();
	});

	test("invalid PID retains the draft and shows a field error", () => {
		const open = reduceInteraction(LIST_FOCUS, { kind: "key", key: "f", ctrl: false, shift: false }, EMPTY_FILTER);
		const pidField = reduceInteraction(open.state, { kind: "key", key: "tab", ctrl: false, shift: false }, EMPTY_FILTER);
		const toPid = reduceInteraction(pidField.state, { kind: "key", key: "tab", ctrl: false, shift: false }, EMPTY_FILTER);
		const edited = reduceInteraction(toPid.state, { kind: "edit-field", value: "abc" }, EMPTY_FILTER);
		const enter = reduceInteraction(edited.state, { kind: "key", key: "enter", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(enter.command).toBeNull();
		expect(enter.state.focus).toBe("filters");

		if (enter.state.focus !== "filters") return;
		expect(enter.state.error?.field).toBe("pid");
		expect(enter.state.draft.pid).toBe("abc");
	});

	test("Ctrl+C quits even in the editor", () => {
		const open = reduceInteraction(LIST_FOCUS, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);
		const quit = reduceInteraction(open.state, { kind: "key", key: "c", ctrl: true, shift: false }, EMPTY_FILTER);
		expect(quit.quit).toBe(true);
	});

	test("Ctrl+U and Ctrl+D page through the list", () => {
		const pageUp = reduceInteraction(LIST_FOCUS, { kind: "key", key: "u", ctrl: true, shift: false }, EMPTY_FILTER);
		const pageDown = reduceInteraction(LIST_FOCUS, { kind: "key", key: "d", ctrl: true, shift: false }, EMPTY_FILTER);

		expect(pageUp.command).toEqual({ kind: "page", delta: -1 });
		expect(pageDown.command).toEqual({ kind: "page", delta: 1 });
	});

	test("w toggles line wrapping", () => {
		const lower = reduceInteraction(LIST_FOCUS, { kind: "key", key: "w", ctrl: false, shift: false }, EMPTY_FILTER);
		const upper = reduceInteraction(LIST_FOCUS, { kind: "key", key: "W", ctrl: false, shift: false }, EMPTY_FILTER);

		expect(lower.command).toEqual({ kind: "toggle-line-display" });
		expect(upper.command).toEqual({ kind: "toggle-line-display" });
	});

	test("m toggles the search mode", () => {
		const toggle = reduceInteraction(LIST_FOCUS, { kind: "key", key: "m", ctrl: false, shift: false }, EMPTY_FILTER);

		expect(toggle.command).toEqual({ kind: "toggle-search-mode" });
	});

	test("Enter opens inspect and t filters the selected tag", () => {
		const opened = reduceInteraction(LIST_FOCUS, { kind: "key", key: "enter", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(opened.state.focus).toBe("inspect");

		const filtered = reduceInteraction(
			opened.state,
			{ kind: "key", key: "t", ctrl: false, shift: false },
			EMPTY_FILTER,
			{ tag: "Database", pid: 4321 },
		);

		expect(filtered.state.focus).toBe("list");
		expect(filtered.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: "Database", pid: null, packageName: null, text: "" },
		});

		if (filtered.state.focus !== "list") return;
		expect(filtered.state.undo).toEqual([EMPTY_FILTER]);
	});
});

describe("query editor", () => {
	test("each valid edit applies and an invalid draft keeps the last filter", () => {
		let state = applyKey(LIST_FOCUS, "/", EMPTY_FILTER).state;
		let active = EMPTY_FILTER;

		for (const key of ["p", "i", "d"]) {
			const step = applyKey(state, key, active);
			state = step.state;
			active = step.active;
		}

		expect(active.text).toBe("pid");
		const invalid = applyKey(state, ":", active);
		expect(invalid.command).toBeNull();
		expect(invalid.active).toEqual(active);

		if (invalid.state.focus !== "query") throw new Error("expected query editor");
		expect(invalid.state.error?.field).toBe("pid");
		expect(invalid.state.draft).toBe("pid:");
	});

	test("Escape restores the filter from when the editor opened", () => {
		const origin: FilterSpec = { ...EMPTY_FILTER, text: "keep" };
		const opened = reduceInteraction(LIST_FOCUS, pressKey("/"), origin);
		const typed = reduceInteraction(opened.state, { kind: "edit-field", value: "gone" }, origin);

		const escaped = reduceInteraction(
			typed.state,
			pressKey("escape"),
			typed.command?.kind === "set-filter" ? typed.command.filter : origin,
		);

		expect(escaped.command).toEqual({ kind: "set-filter", filter: origin });
		expect(escaped.state.focus).toBe("list");
	});

	test("Enter records history and Up recalls an earlier query", () => {
		let state = LIST_FOCUS;
		let active = EMPTY_FILTER;
		state = applyKey(state, "/", active).state;
		const typed = reduceInteraction(state, { kind: "edit-field", value: "alpha" }, active);
		state = typed.state;

		if (typed.command?.kind === "set-filter") active = typed.command.filter;
		const entered = applyKey(state, "enter", active);
		state = entered.state;
		active = entered.active;

		expect(state.focus).toBe("list");

		if (state.focus !== "list") return;
		expect(state.history).toEqual(["alpha"]);

		state = applyKey(state, "/", active).state;
		const cleared = reduceInteraction(state, { kind: "edit-field", value: "" }, active);
		state = cleared.state;

		if (cleared.command?.kind === "set-filter") active = cleared.command.filter;
		const recalled = applyKey(state, "up", active);

		expect(recalled.command).toEqual({ kind: "set-filter", filter: { ...EMPTY_FILTER, text: "alpha" } });

		if (recalled.state.focus !== "query") return;
		expect(recalled.state.draft).toBe("alpha");
		expect(recalled.state.historyIndex).toBe(0);
	});

	test("x clears filters and u restores them", () => {
		let state = applyKey(LIST_FOCUS, "/", EMPTY_FILTER).state;
		const typed = reduceInteraction(state, { kind: "edit-field", value: "lock" }, EMPTY_FILTER);
		state = applyKey(typed.state, "enter", typed.command?.kind === "set-filter" ? typed.command.filter : EMPTY_FILTER).state;
		const cleared = applyKey(state, "x", { ...EMPTY_FILTER, text: "lock" });

		expect(cleared.command).toEqual({ kind: "set-filter", filter: EMPTY_FILTER });
		const restored = applyKey(cleared.state, "u", EMPTY_FILTER);

		expect(restored.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, packageName: null, text: "lock" },
		});
	});

	test("c copies the canonical query", () => {
		const active: FilterSpec = { ...EMPTY_FILTER, minLevel: "W", tag: "Database", text: "lock" };
		const copied = reduceInteraction(LIST_FOCUS, pressKey("c"), active);

		expect(copied.command).toBeNull();
		expect(copied.effect).toEqual({ kind: "copy", text: "level:W tag:Database lock" });
	});

	test("Jev mode applies the query on Enter", () => {
		let state = applyKey(LIST_FOCUS, "/", EMPTY_FILTER, "jev").state;

		for (const key of ["l", "o", "c", "k"]) {
			const step = applyKey(state, key, EMPTY_FILTER, "jev");
			expect(step.command).toBeNull();
			state = step.state;
		}

		const entered = applyKey(state, "enter", EMPTY_FILTER, "jev");

		expect(entered.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, packageName: null, text: "lock" },
		});
		expect(entered.state.focus).toBe("list");
	});

	test("history and undo keep the newest 20 entries", () => {
		let state: InteractionState = LIST_FOCUS;
		let active = EMPTY_FILTER;

		for (let index = 0; index < 21; index += 1) {
			const query = `q${index}`;
			state = applyKey(state, "/", active).state;
			const typed = reduceInteraction(state, { kind: "edit-field", value: query }, active);
			state = typed.state;

			if (typed.command?.kind === "set-filter") active = typed.command.filter;
			const entered = applyKey(state, "enter", active);
			state = entered.state;
			active = entered.active;
		}

		expect(state.history).toHaveLength(20);
		expect(state.history[0]).toBe("q20");
		expect(state.history[19]).toBe("q1");
		expect(state.undo).toHaveLength(20);
		expect(state.undo[0]?.text).toBe("q19");
	});
});
