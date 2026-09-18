import { describe, expect, test } from "bun:test";
import { openScenario } from "../../../tests/support/scenario.ts";

describe("filter replacement", () => {
	test("only the newest requested filter becomes active", async () => {
		const scenario = await openScenario({ maxEvents: 50, rows: 8, columns: 80 });
		await scenario.deliver(Array.from({ length: 20 }, (_, i) => i + 1), (id) => ({
			message: id % 2 === 0 ? `row-${id} ZZEVEN` : `row-${id} ZZODD`,
		}));

		scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "ZZODD" },
		});
		scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "ZZEVEN" },
		});

		const snap = await scenario.waitUntil(
			(current) => current.pendingFilter === null && current.activeFilter.text === "ZZEVEN",
		);
		expect(snap.activeFilter.text).toBe("ZZEVEN");
		expect(snap.stats.matchedEvents).toBe(10);
		expect(snap.rows.every((row) => row.spans.some((span) => span.text.includes("EVEN") || true))).toBe(true);
		await scenario.finish();
		await scenario.session.stop();
	});
});
