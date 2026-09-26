import { describe, expect, test } from "bun:test";
import { eventChargeBytes, type LogEvent } from "@logcayo/core";
import { formatClipboardEvent } from "../src/clipboard.ts";

function event(rawText: string, continuations: readonly string[] = []): LogEvent {
	const tag = "Database";
	const message = "Retry after lock timeout";

	return {
		id: 1,
		sourceOffsetMs: 0,
		rawText,
		metadata: {
			epochMicros: 1760000000002000,
			pid: 4321,
			tid: 4340,
			level: "W",
			tag: { start: rawText.indexOf(tag), end: rawText.indexOf(tag) + tag.length },
			message: { start: rawText.indexOf(message), end: rawText.length },
		},
		continuations,
		endedWithLf: true,
		omittedBytes: 0,
		invalidUtf8: false,
		chargeBytes: eventChargeBytes(rawText, continuations),
	};
}

describe("clipboard event formatting", () => {
	test("copies a complete readable entry with continuations", () => {
		const raw = "1760000000.002000  4321  4340 W Database: Retry after lock timeout";

		expect(
			formatClipboardEvent(event(raw, ["\tat com.example.demo.Store.lock(Store.java:88)", "\tat com.example.demo.Store.write(Store.java:41)"])),
		).toBe(
			[
				"2025-10-09 08:53:20.002 W 4321:4340 Database",
				"Retry after lock timeout",
				"    at com.example.demo.Store.lock(Store.java:88)",
				"    at com.example.demo.Store.write(Store.java:41)",
			].join("\n"),
		);
	});

	test("escapes terminal control bytes before copying", () => {
		const raw = "1760000000.002000  4321  4340 W Database: Retry after lock timeout\u001b[31m";

		expect(formatClipboardEvent(event(raw))).toContain("Retry after lock timeout^[[31m");
	});
});
