import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_HISTORY_CHARGE_BYTES, logViewportHeight } from "@logcayo/core";
import { measureSession } from "../../bench/session-bench.ts";

describe("PRD structural performance bounds", () => {
	test("snapshots keep a bounded visible window and drain the input queue", async () => {
		const rows = 8;
		const count = 400;

		const result = await measureSession({
			mode: "headless",
			workload: "bounds-ingest",
			count,
			maxEvents: 80,
			maxHistoryChargeBytes: DEFAULT_MAX_HISTORY_CHARGE_BYTES,
			columns: 80,
			rows,
			filterText: null,
			moves: 0,
		});

		expect(result.admitted).toBe(count);
		expect(result.retained).toBe(80);
		expect(result.rowObjects).toBeLessThanOrEqual(logViewportHeight(rows));
		expect(result.queuedBytes).toBe(0);
		expect(result.chargedHistoryBytes).toBeLessThanOrEqual(DEFAULT_MAX_HISTORY_CHARGE_BYTES);
	});

	test("filter replacement publishes a new match set without growing the row window", async () => {
		const rows = 24;
		const count = 800;

		const result = await measureSession({
			mode: "headless",
			workload: "bounds-filter",
			count,
			maxEvents: count,
			maxHistoryChargeBytes: DEFAULT_MAX_HISTORY_CHARGE_BYTES,
			columns: 80,
			rows,
			filterText: "KEEP",
			moves: 8,
		});

		expect(result.admitted).toBe(count);
		expect(result.matchedEvents).toBe(Math.floor((count - 1) / 10) + 1);
		expect(result.rowObjects).toBeLessThanOrEqual(logViewportHeight(rows));
		expect(result.queuedBytes).toBe(0);
		expect(result.filterMs).not.toBeNull();
	});
});
