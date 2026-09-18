import { describe, expect, test } from "bun:test";
import { EMPTY_FILTER, INSPECT_FOCUS, LIST_FOCUS, displayWidth } from "@logview/core";
import { layoutFrame } from "../src/app.ts";
import { openScenario } from "../../../tests/support/scenario.ts";

describe("UI state scenarios", () => {
	test("replay navigation moves through browse and returns to tail", async () => {
		const scenario = await openScenario({ maxEvents: 32, columns: 120, rows: 24 });
		await scenario.deliver(Array.from({ length: 20 }, (_, index) => index + 1));
		await scenario.finish();

		expect(scenario.session.snapshot().view.mode).toBe("tail");
		expect(scenario.session.dispatch({ kind: "move", delta: -1 }).ok).toBe(true);
		expect(scenario.session.snapshot().view.mode).toBe("browse");
		expect(scenario.session.dispatch({ kind: "page", delta: -1 }).ok).toBe(true);
		expect(scenario.session.dispatch({ kind: "tail" }).ok).toBe(true);
		expect(scenario.session.snapshot().view.mode).toBe("tail");
		await scenario.session.stop();
	});

	test("inspector changes from overlay at 119 columns to split pane at 120", async () => {
		const scenario = await openScenario({ maxEvents: 8, columns: 120, rows: 16 });
		await scenario.deliver([1, 2, 3]);
		await scenario.finish();
		const snapshot = scenario.session.snapshot();
		const narrow = layoutFrame(snapshot, INSPECT_FOCUS, 119, 16, "plain");
		const wide = layoutFrame(snapshot, INSPECT_FOCUS, 120, 16, "plain");

		expect(narrow[2]?.startsWith("Event")).toBe(true);
		expect(wide[2]?.includes("│")).toBe(true);

		for (const frame of [narrow, wide]) {
			for (const line of frame) expect(displayWidth(line)).toBe(frame === narrow ? 119 : 120);
		}

		await scenario.session.stop();
	});

	test("text filter application and zero matches use Session commands", async () => {
		const scenario = await openScenario({ maxEvents: 8, columns: 72, rows: 16 });
		await scenario.deliver([1, 2, 3], (id) => ({ message: id === 2 ? "Database opened" : "other event" }));
		await scenario.finish();

		expect(
			scenario.session.dispatch({ kind: "set-filter", filter: { ...EMPTY_FILTER, text: "database" } }).ok,
		).toBe(true);
		await scenario.scheduler.runUntilIdle();
		expect(scenario.session.snapshot().activeFilter.text).toBe("database");
		expect(scenario.session.snapshot().stats.matchedEvents).toBe(1);

		expect(
			scenario.session.dispatch({ kind: "set-filter", filter: { ...EMPTY_FILTER, text: "no-match" } }).ok,
		).toBe(true);
		await scenario.scheduler.runUntilIdle();
		expect(scenario.session.snapshot().stats.matchedEvents).toBe(0);
		await scenario.session.stop();
	});

	test("minimum-size state remains a plain fixed-width warning", async () => {
		const scenario = await openScenario({ columns: 48, rows: 12 });
		await scenario.deliver([1]);
		await scenario.finish();
		expect(scenario.session.dispatch({ kind: "resize", columns: 39, rows: 7 }).ok).toBe(true);
		const frame = layoutFrame(scenario.session.snapshot(), LIST_FOCUS, 39, 7, "plain");

		expect(frame[0]).toContain("Terminal too small");
		for (const line of frame) {
			expect(displayWidth(line)).toBe(39);
			expect(line.includes("\u001b")).toBe(false);
		}

		await scenario.session.stop();
	});
});
