import { describe, expect, test } from "bun:test";
import {
	CHROME_ROWS,
	containsControlBytes,
	displayWidth,
	eventChargeBytes,
	logViewportHeight,
	projectRows,
	requiresResize,
	rowDisplayText,
	rowText,
	type LogEvent,
} from "@logview/core";

function event(
	id: number,
	rawText: string,
	metadata: LogEvent["metadata"] = null,
	continuations: readonly string[] = [],
): LogEvent {
	return {
		id,
		sourceOffsetMs: 0,
		rawText,
		metadata,
		continuations,
		endedWithLf: true,
		omittedBytes: 0,
		invalidUtf8: false,
		chargeBytes: eventChargeBytes(rawText, continuations),
	};
}

describe("projection", () => {
	test("CHROME_ROWS leaves five visible log rows in an 8-row terminal", () => {
		expect(CHROME_ROWS).toBe(3);
		expect(logViewportHeight(8)).toBe(5);
		expect(requiresResize(39, 8)).toBe(true);
		expect(requiresResize(40, 7)).toBe(true);
		expect(requiresResize(40, 8)).toBe(false);
	});

	test("projects parsed rows with a selection marker and clips long messages", () => {
		const raw = "1760000000.123456     1     1 I Database: " + "x".repeat(400);

		const rows = projectRows(
			[
				event(1, raw, {
					epochMicros: 1760000000123456,
					pid: 1,
					tid: 1,
					level: "I",
					tag: { start: 34, end: 42 },
					message: { start: 44, end: raw.length },
				}),
			],
			1,
			80,
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]!.selected).toBe(true);
		expect(rows[0]!.level).toBe("I");
		expect(rowText(rows[0]!)).not.toContain("\u001b");
		expect(rows[0]!.clipped).toBe(true);
		expect(displayWidth(rowDisplayText(rows[0]!))).toBeLessThanOrEqual(80);
	});

	test("escapes control bytes instead of emitting terminal sequences", () => {
		const rows = projectRows([event(2, "oops \u001b[31mred")], null, 80);
		expect(containsControlBytes(rowText(rows[0]!))).toBe(false);
		expect(rowText(rows[0]!)).toContain("^[");
	});

	test("CJK messages plus the marker stay within the terminal width", () => {
		const raw = "1760000000.123456     1     1 I logview-demo: 日本語 ok " + "あ".repeat(80);

		const rows = projectRows(
			[
				event(3, raw, {
					epochMicros: 1760000000123456,
					pid: 1,
					tid: 1,
					level: "I",
					tag: { start: 34, end: 46 },
					message: { start: 48, end: raw.length },
				}),
			],
			3,
			40,
		);

		expect(displayWidth(rowDisplayText(rows[0]!))).toBeLessThanOrEqual(40);
	});

	test("groups continuations under the parent event", () => {
		const raw = "1760000000.123456     1     1 W Database: Retry after lock timeout";

		const rows = projectRows(
			[
				event(
					4,
					raw,
					{
						epochMicros: 1760000000123456,
						pid: 1,
						tid: 1,
						level: "W",
						tag: { start: 34, end: 42 },
						message: { start: 44, end: raw.length },
					},
					["\tat com.example.Store.lock(Store.java:88)", "not a header line"],
				),
			],
			4,
			80,
		);

		expect(rows.length).toBe(3);
		expect(rows[0]!.kind).toBe("header");
		expect(rows[1]!.kind).toBe("continuation");
		expect(rows[2]!.kind).toBe("continuation");
		expect(rows[1]!.id).toBe(4);
		expect(rowText(rows[1]!)).toContain("Store.lock");

		for (const row of rows) {
			expect(displayWidth(rowDisplayText(row))).toBeLessThanOrEqual(80);
		}
	});
});
