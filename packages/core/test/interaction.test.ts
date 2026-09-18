import { describe, expect, test } from "bun:test";
import { EMPTY_FILTER, LIST_FOCUS, reduceInteraction } from "@logview/core";

describe("reduceInteraction", () => {
	test("/ then text then Enter produces a text-filter command", () => {
		let state = LIST_FOCUS;
		const slash = reduceInteraction(state, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);
		state = slash.state;
		expect(state.focus).toBe("filters");
		if (state.focus !== "filters") return;
		expect(state.field).toBe("text");
		const typed = reduceInteraction(state, { kind: "edit-field", value: "database" }, EMPTY_FILTER);
		const enter = reduceInteraction(typed.state, { kind: "key", key: "enter", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(enter.state).toEqual(LIST_FOCUS);
		expect(enter.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "database" },
		});
		expect(enter.quit).toBe(false);
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
		expect(q.command).toBeNull();
		if (q.state.focus !== "filters") throw new Error("expected editor");
		expect(q.state.draft.text).toBe("q");
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
});
