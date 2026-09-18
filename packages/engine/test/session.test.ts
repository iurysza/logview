import { describe, expect, test } from "bun:test";
import { openScenario } from "../../../tests/support/scenario.ts";

describe("headless session", () => {
	test("the PRD acceptance scenario: tail, browse, eviction, filter, resume", async () => {
		const scenario = await openScenario({ maxEvents: 8, rows: 8, columns: 120 });
		const keep = new Set([8, 10, 14]);

		await scenario.deliver([1, 2, 3, 4, 5, 6, 7, 8], (id) => ({
			message: keep.has(id) ? `event-${id} KEEP` : `event-${id}`,
		}));

		let snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("tail");
		expect(snap.rows.map((row) => row.id)).toEqual([4, 5, 6, 7, 8]);
		expect(snap.view.selectedId).toBe(8);

		scenario.session.dispatch({ kind: "move", delta: -1 });
		scenario.session.dispatch({ kind: "move", delta: -1 });
		snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.topId).toBe(4);
		expect(snap.view.selectedId).toBe(6);

		await scenario.deliver([9, 10], (id) => ({
			message: keep.has(id) ? `event-${id} KEEP` : `event-${id}`,
		}));
		snap = scenario.session.snapshot();
		expect(snap.stats.retainedEvents).toBe(8);
		expect(snap.rows.map((row) => row.id)).toEqual([4, 5, 6, 7, 8]);
		expect(snap.view.selectedId).toBe(6);
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.newSincePause).toBe(2);

		await scenario.deliver([11, 12, 13, 14], (id) => ({
			message: keep.has(id) ? `event-${id} KEEP` : `event-${id}`,
		}));
		snap = scenario.session.snapshot();
		expect(snap.stats.retainedEvents).toBe(8);
		expect(snap.rows.map((row) => row.id)).toEqual([7, 8, 9, 10, 11]);
		expect(snap.view.selectedId).toBe(7);
		expect(snap.view.mode).toBe("browse");
		expect(snap.notice).toBe("history-expired");

		const filtered = scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "KEEP" },
		});

		expect(filtered.ok).toBe(true);
		snap = await scenario.waitUntil((current) => current.pendingFilter === null && current.stats.matchedEvents === 3);
		expect(snap.rows.map((row) => row.id)).toEqual([8, 10, 14]);
		expect(snap.view.selectedId).toBe(8);
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.newSincePause).toBe(0);

		scenario.session.dispatch({ kind: "tail" });
		snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("tail");
		expect(snap.view.selectedId).toBe(14);

		await scenario.finish();
		await scenario.session.stop();
	});

	test("double stop is safe and source completion leaves the view intact", async () => {
		const scenario = await openScenario();
		await scenario.deliver([1, 2, 3]);
		await scenario.finish();
		expect(scenario.session.snapshot().stats.admittedEvents).toBe(3);
		expect(scenario.session.snapshot().source.kind).toBe("ended");
		await scenario.session.stop();
		await scenario.session.stop();
		const stopped = scenario.session.dispatch({ kind: "tail" });
		expect(stopped.ok).toBe(false);
	});
});
