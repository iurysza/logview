import { describe, expect, test } from "bun:test";
import { parseLogcatLine } from "@logcayo/core";

function line(text: string, extras?: { omittedBytes?: number; endedWithLf?: boolean }) {
	return {
		bytes: new TextEncoder().encode(text),
		endedWithLf: extras?.endedWithLf ?? true,
		omittedBytes: extras?.omittedBytes ?? 0,
	};
}

describe("parseLogcatLine", () => {
	test("parses the canonical threadtime epoch usec profile", () => {
		const parsed = parseLogcatLine(line("1760000000.123456  1234  1250 I Database: BEGIN TRANSACTION"));
		expect(parsed.kind).toBe("event");

		if (parsed.kind !== "event") return;
		expect(parsed.invalidUtf8).toBe(false);
		expect(parsed.metadata).not.toBeNull();
		expect(parsed.metadata?.epochMicros).toBe(1760000000 * 1_000_000 + 123456);
		expect(parsed.metadata?.pid).toBe(1234);
		expect(parsed.metadata?.tid).toBe(1250);
		expect(parsed.metadata?.level).toBe("I");
		expect(parsed.rawText.slice(parsed.metadata!.tag.start, parsed.metadata!.tag.end)).toBe("Database");
		expect(parsed.rawText.slice(parsed.metadata!.message.start, parsed.metadata!.message.end)).toBe(
			"BEGIN TRANSACTION",
		);
	});

	test("parses UID from the UID-enabled capture profile", () => {
		const parsed = parseLogcatLine(line("1760000000.123456  10123  1234  1250 I Database: BEGIN TRANSACTION"));
		expect(parsed.kind).toBe("event");

		if (parsed.kind !== "event") return;
		expect(parsed.metadata?.uid).toBe(10123);
		expect(parsed.metadata?.pid).toBe(1234);
		expect(parsed.metadata?.tid).toBe(1250);
	});

	test("parses the leading whitespace used by physical device Logcat output", () => {
		const parsed = parseLogcatLine(line("         1760000000.123456  1234  1250 I Database: BEGIN TRANSACTION"));
		expect(parsed.kind).toBe("event");

		if (parsed.kind !== "event") return;
		expect(parsed.metadata).not.toBeNull();
		expect(parsed.rawText.slice(parsed.metadata!.tag.start, parsed.metadata!.tag.end)).toBe("Database");
		expect(parsed.rawText.slice(parsed.metadata!.message.start, parsed.metadata!.message.end)).toBe(
			"BEGIN TRANSACTION",
		);
	});

	test("treats blank lines and buffer markers as control input", () => {
		expect(parseLogcatLine(line(""))).toEqual({ kind: "control", control: "blank" });
		expect(parseLogcatLine(line("--------- beginning of main"))).toEqual({
			kind: "control",
			control: "buffer-marker",
		});
	});

	test("preserves unmatched continuation lines as unparsed events", () => {
		const parsed = parseLogcatLine(line("    at com.example.App.crash(App.java:32)"));
		expect(parsed.kind).toBe("event");

		if (parsed.kind !== "event") return;
		expect(parsed.metadata).toBeNull();
		expect(parsed.rawText).toContain("App.java");
	});

	test("flags invalid UTF-8 with replacement text", () => {
		const parsed = parseLogcatLine({
			bytes: new Uint8Array([0x61, 0xff, 0x62]),
			endedWithLf: true,
			omittedBytes: 0,
		});

		expect(parsed.kind).toBe("event");

		if (parsed.kind !== "event") return;
		expect(parsed.invalidUtf8).toBe(true);
		expect(parsed.rawText.includes("\uFFFD") || parsed.rawText.includes("b")).toBe(true);
	});
});
