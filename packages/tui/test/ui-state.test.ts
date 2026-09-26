import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { EMPTY_FILTER, EMPTY_SELECTION, INSPECT_FOCUS, LIST_FOCUS, displayWidth, reduceInteraction, type InteractionState } from "@logview/core";
import { createRecordingFiles, createReplaySource, createSession, defaultSessionOptions } from "@logview/engine";
import { layoutFrame } from "../src/app.ts";
import { FILTER_CONTRACT_CASES, FILTER_CONTRACT_FIXTURE } from "../../../tests/contract/filter-cases.ts";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";
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

describe("query contract", () => {
	// TODO(coordinator): switch to readMatches after merge
	for (const contract of FILTER_CONTRACT_CASES) {
		test(contract.query.length === 0 ? "empty query matches every event" : contract.query, async () => {
			const scheduler = new ManualScheduler();

			const replay = createReplaySource(
				{ path: join(import.meta.dir, "../../..", FILTER_CONTRACT_FIXTURE), speed: { kind: "instant" }, allowPartial: false },
				{ files: createRecordingFiles(), scheduler },
			);

			expect(replay.ok).toBe(true);

			if (!replay.ok) return;

			const created = createSession(
				defaultSessionOptions({ sessionId: "query-contract", sourceKind: "replay", rows: 60, columns: 120 }),
				{ source: replay.value, scheduler },
			);

			expect(created.ok).toBe(true);

			if (!created.ok) return;

			const session = created.value;
			expect(session.start().ok).toBe(true);
			await scheduler.runUntilIdle();
			await session.sourceDone;
			await scheduler.runUntilIdle();

			let interaction: InteractionState = LIST_FOCUS;

			const typeKey = async (key: string): Promise<void> => {
				const snapshot = session.snapshot();

				const result = reduceInteraction(
					interaction,
					{ kind: "key", key, ctrl: false, shift: false },
					snapshot.activeFilter,
					EMPTY_SELECTION,
					snapshot.searchMode,
				);

				interaction = result.state;

				if (!result.command) return;

				expect(session.dispatch(result.command).ok).toBe(true);
				await scheduler.runUntilIdle();
			};

			await typeKey("/");

			if (interaction.focus === "query") {
				const draft = [...interaction.draft];

				for (let index = 0; index < draft.length; index += 1) await typeKey("backspace");
			}

			for (const char of contract.query) await typeKey(char);
			await typeKey("enter");
			await scheduler.runUntilIdle();

			const ids: number[] = [];

			for (const row of session.snapshot().rows) {
				if (row.kind === "header") ids.push(row.id);
			}

			expect(ids).toEqual([...contract.expectedIds]);
			await session.stop();
		});
	}
});
