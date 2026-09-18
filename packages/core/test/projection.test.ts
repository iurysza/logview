import { describe, expect, test } from "bun:test";
import {
	CHROME_ROWS,
	containsControlBytes,
	eventChargeBytes,
	logViewportHeight,
	projectRows,
	requiresResize,
	rowText,
	type LogEvent,
} from "@logview/core";

function event(id: number, rawText: string, metadata: LogEvent["metadata"] = null): LogEvent {
	return {
		id,
		sourceOffsetMs: 0,
		rawText,
		metadata,
		endedWithLf: true,
		omittedBytes: 0,
		invalidUtf8: false,
		chargeBytes: eventChargeBytes(rawText),
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
	});

	test("escapes control bytes instead of emitting terminal sequences", () => {
		const rows = projectRows([event(2, "oops \u001b[31mred")], null, 80);
		expect(containsControlBytes(rowText(rows[0]!))).toBe(false);
		expect(rowText(rows[0]!)).toContain("^[");
	});
});
