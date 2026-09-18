import { describe, expect, test } from "bun:test";
import { matches, parseLogcatLine, prepareFilter } from "@logview/core";
import { EMPTY_FILTER, eventChargeBytes, LIST_FOCUS, reduceInteraction } from "@logview/core";

function parsedEvent(raw: string) {
	const parsed = parseLogcatLine({
		bytes: new TextEncoder().encode(raw),
		endedWithLf: true,
		omittedBytes: 0,
	});

	if (parsed.kind !== "event") throw new Error("expected event");

	return {
		id: 1,
		sourceOffsetMs: 0,
		rawText: parsed.rawText,
		metadata: parsed.metadata,
		endedWithLf: true,
		omittedBytes: 0,
		invalidUtf8: parsed.invalidUtf8,
		chargeBytes: eventChargeBytes(parsed.rawText),
	};
}

describe("filters and interaction", () => {
	test("prepares level, tag, pid, and literal text restrictions", () => {
		const prepared = prepareFilter({ minLevel: "W", tag: "Database", pid: 12, text: "LOCK" });
		expect(prepared.ok).toBe(true);

		if (!prepared.ok) return;

		const matching = parsedEvent("1760000000.000001    12    12 W Database: LOCK timeout");
		expect(matches(matching, prepared.value)).toBe(true);
		expect(matches(parsedEvent("1760000000.000001    12    12 I Database: LOCK timeout"), prepared.value)).toBe(
			false,
		);
	});

	test("slash, text edit, and enter produce a text-filter command", () => {
		const opened = reduceInteraction(LIST_FOCUS, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(opened.state.focus).toBe("filters");

		const typed = reduceInteraction(opened.state, { kind: "edit-field", value: "database" }, EMPTY_FILTER);

		const committed = reduceInteraction(
			typed.state,
			{ kind: "key", key: "enter", ctrl: false, shift: false },
			EMPTY_FILTER,
		);

		expect(committed.command).toEqual({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "database" },
		});
		expect(committed.state).toEqual(LIST_FOCUS);
	});

	test("escape discards a draft and q is text inside the editor", () => {
		const opened = reduceInteraction(LIST_FOCUS, { kind: "key", key: "/", ctrl: false, shift: false }, EMPTY_FILTER);

		const escaped = reduceInteraction(
			opened.state,
			{ kind: "key", key: "escape", ctrl: false, shift: false },
			EMPTY_FILTER,
		);

		expect(escaped.command).toBeNull();
		expect(escaped.state).toEqual(LIST_FOCUS);

		const q = reduceInteraction(opened.state, { kind: "key", key: "q", ctrl: false, shift: false }, EMPTY_FILTER);
		expect(q.quit).toBe(false);

		if (q.state.focus === "filters") expect(q.state.draft.text.endsWith("q")).toBe(true);
	});
});
