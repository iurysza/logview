import { describe, expect, test } from "bun:test";
import { EMPTY_FILTER, ok } from "@logview/core";
import type { PackageResolver } from "@logview/engine";
import { threadtimeLine } from "../../../tests/support/log-lines.ts";
import { openScenario, tick } from "../../../tests/support/scenario.ts";

describe("headless session", () => {
	test("the PRD acceptance scenario: tail, browse, eviction, filter, resume", async () => {
		const scenario = await openScenario({ maxEvents: 8, rows: 8, columns: 120 });
		const keep = new Set([8, 10, 14]);

		await scenario.deliver([1, 2, 3, 4, 5, 6, 7, 8], (id) => ({
			message: keep.has(id) ? `event-${id} KEEP` : `event-${id}`,
		}));

		let snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("tail");
		expect(snap.rows.map((row) => row.id)).toEqual([7, 8]);
		expect(snap.view.selectedId).toBe(8);

		scenario.session.dispatch({ kind: "move", delta: -1 });
		scenario.session.dispatch({ kind: "move", delta: -1 });
		snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.topId).toBe(5);
		expect(snap.view.selectedId).toBe(6);

		await scenario.deliver([9, 10], (id) => ({
			message: keep.has(id) ? `event-${id} KEEP` : `event-${id}`,
		}));
		snap = scenario.session.snapshot();
		expect(snap.stats.retainedEvents).toBe(8);
		expect(snap.rows.map((row) => row.id)).toEqual([5, 6]);
		expect(snap.view.selectedId).toBe(6);
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.newSincePause).toBe(2);

		await scenario.deliver([11, 12, 13, 14], (id) => ({
			message: keep.has(id) ? `event-${id} KEEP` : `event-${id}`,
		}));
		snap = scenario.session.snapshot();
		expect(snap.stats.retainedEvents).toBe(8);
		expect(snap.rows.map((row) => row.id)).toEqual([7, 8]);
		expect(snap.view.selectedId).toBe(7);
		expect(snap.view.mode).toBe("browse");
		expect(snap.notice).toBe("history-expired");

		const filtered = scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "KEEP" },
		});

		expect(filtered.ok).toBe(true);
		snap = await scenario.waitUntil((current) => current.pendingFilter === null && current.stats.matchedEvents === 3);
		expect(snap.rows.map((row) => row.id)).toEqual([8, 10]);
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

	test("line display toggles between clipped and wrapped rows", async () => {
		const scenario = await openScenario({ rows: 8, columns: 48 });
		await scenario.deliver([1], () => ({ message: "retrying database connection after a transient network failure" }));

		const clipped = scenario.session.snapshot();
		expect(clipped.lineDisplay).toBe("clip");
		expect(clipped.rows).toHaveLength(1);

		expect(scenario.session.dispatch({ kind: "toggle-line-display" }).ok).toBe(true);
		const wrapped = scenario.session.snapshot();
		expect(wrapped.lineDisplay).toBe("wrap");
		expect(wrapped.rows.length).toBeGreaterThan(1);
		expect(wrapped.view.selectedId).toBe(1);

		scenario.session.dispatch({ kind: "toggle-line-display" });
		expect(scenario.session.snapshot().lineDisplay).toBe("clip");
		expect(scenario.session.snapshot().rows).toHaveLength(1);

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

	test("down on the newest event stays in browse; only tail command resumes following", async () => {
		const scenario = await openScenario({ maxEvents: 8, rows: 8, columns: 120 });
		await scenario.deliver([1, 2, 3, 4, 5, 6, 7, 8]);

		scenario.session.dispatch({ kind: "move", delta: 1 });
		let snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.selectedId).toBe(8);

		await scenario.deliver([9]);
		snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("browse");
		expect(snap.view.selectedId).toBe(8);
		expect(snap.view.newSincePause).toBe(1);

		scenario.session.dispatch({ kind: "tail" });
		snap = scenario.session.snapshot();
		expect(snap.view.mode).toBe("tail");
		expect(snap.view.selectedId).toBe(9);

		await scenario.finish();
		await scenario.session.stop();
	});

	test("page navigation keeps the selected header visible across continuation rows", async () => {
		const scenario = await openScenario({ maxEvents: 20, rows: 8, columns: 100 });

		for (let id = 1; id <= 12; id += 1) {
			scenario.source.pushLine(threadtimeLine(id, { message: `event-${id}` }), id);

			if (id % 3 === 0) scenario.source.pushLine(`\tat com.example.App.row${id}(App.java:${id})`, id);
		}

		await tick(scenario.scheduler);

		const assertSelectionVisible = (): void => {
			const snapshot = scenario.session.snapshot();
			expect(
				snapshot.rows.some((row) => row.id === snapshot.view.selectedId && row.kind === "header" && row.selected),
			).toBe(true);
		};

		scenario.session.dispatch({ kind: "oldest" });
		assertSelectionVisible();

		for (let i = 0; i < 12; i += 1) {
			scenario.session.dispatch({ kind: "page", delta: 1 });
			assertSelectionVisible();
		}

		expect(scenario.session.snapshot().view.selectedId).toBe(12);

		for (let i = 0; i < 12; i += 1) {
			scenario.session.dispatch({ kind: "page", delta: -1 });
			assertSelectionVisible();
		}

		expect(scenario.session.snapshot().view.selectedId).toBe(1);
		await scenario.finish();
		await scenario.session.stop();
	});

	test("resolves detail attribution lazily and filters by its UID set", async () => {
		let loads = 0;

		const packageResolver: PackageResolver = {
			async load() {
				loads += 1;

				return ok([
					{ uid: 10123, packages: ["com.example.app", "com.example.shared"] },
					{ uid: 10124, packages: ["com.example.other"] },
				]);
			},
		};

		const scenario = await openScenario({ packageResolver, maxEvents: 8, rows: 8, columns: 100 });
		await scenario.deliver([1, 2], (id) => ({ uid: id === 1 ? 10123 : 10124 }));

		expect(scenario.session.snapshot().packageAttribution).toEqual({ kind: "idle" });
		expect(scenario.session.dispatch({ kind: "request-package-attribution" }).ok).toBe(true);
		const attributed = await scenario.waitUntil((snapshot) => snapshot.packageAttribution.kind === "resolved");
		expect(attributed.packageAttribution).toEqual({
			kind: "resolved",
			uid: 10124,
			packages: ["com.example.other"],
		});

		expect(
			scenario.session.dispatch({
				kind: "set-filter",
				filter: { ...EMPTY_FILTER, packageName: "com.example.app" },
			}).ok,
		).toBe(true);
		const filtered = await scenario.waitUntil((snapshot) => snapshot.pendingFilter === null && snapshot.activeFilter.packageName !== null);
		expect(filtered.stats.matchedEvents).toBe(1);
		expect(filtered.selectedEvent?.metadata?.uid).toBe(10123);
		expect(loads).toBe(2);
		await scenario.finish();
		await scenario.session.stop();
	});

	test("attaches unmatched lines to the previous event", async () => {
		const scenario = await openScenario({ maxEvents: 20, rows: 16, columns: 100 });
		await scenario.deliver([1], () => ({ level: "E", message: "failed" }));
		scenario.source.pushLine("\tat com.example.App.crash(App.java:32)", 2);
		scenario.source.pushLine("not a header line", 3);
		await tick(scenario.scheduler);

		const snap = scenario.session.snapshot();
		expect(snap.stats.admittedEvents).toBe(1);
		expect(snap.stats.unparsedEvents).toBe(2);
		expect(snap.selectedEvent?.continuations).toEqual([
			"\tat com.example.App.crash(App.java:32)",
			"not a header line",
		]);
		expect(snap.rows.some((row) => row.kind === "continuation")).toBe(true);

		await scenario.finish();
		await scenario.session.stop();
	});
});
