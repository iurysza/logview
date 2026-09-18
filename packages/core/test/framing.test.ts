import { describe, expect, test } from "bun:test";
import { emptyFramerState, frameBytes, parseLogcatLine } from "@logview/core";

describe("framing and logcat", () => {
	test("a line split inside its timestamp and a UTF-8 character round-trips", () => {
		const line = "1760000000.123456  1234  1250 I Database: café\n";
		const bytes = new TextEncoder().encode(line);
		const splitAt = bytes.indexOf(0xc3);
		expect(splitAt).toBeGreaterThan(0);

		const first = frameBytes(emptyFramerState(), bytes.subarray(0, splitAt), {
			eof: false,
			maxLineBytes: 64 * 1024,
			maxLines: 16,
		});
		expect(first.lines).toHaveLength(0);

		const second = frameBytes(first.state, bytes.subarray(splitAt), {
			eof: false,
			maxLineBytes: 64 * 1024,
			maxLines: 16,
		});
		expect(second.lines).toHaveLength(1);
		const parsed = parseLogcatLine(second.lines[0]!);
		expect(parsed.kind).toBe("event");
		if (parsed.kind !== "event") return;
		expect(parsed.rawText).toBe(line.trimEnd());
		expect(parsed.metadata?.level).toBe("I");
		expect(parsed.invalidUtf8).toBe(false);
	});

	test("CRLF, EOF without LF, invalid UTF-8, blanks, and over-cap lines", () => {
		const crlf = frameBytes(emptyFramerState(), new TextEncoder().encode("1760000000.000001  1  1 I T: a\r\n"), {
			eof: false,
			maxLineBytes: 64 * 1024,
			maxLines: 8,
		});
		expect(parseLogcatLine(crlf.lines[0]!).kind).toBe("event");

		const eof = frameBytes(emptyFramerState(), new TextEncoder().encode("1760000000.000002  1  1 I T: unterminated"), {
			eof: true,
			maxLineBytes: 64 * 1024,
			maxLines: 8,
		});
		expect(eof.lines[0]?.endedWithLf).toBe(false);

		const invalid = parseLogcatLine({
			bytes: new Uint8Array([0xff, 0xfe, 0x61]),
			endedWithLf: true,
			omittedBytes: 0,
		});
		expect(invalid.kind).toBe("event");
		if (invalid.kind === "event") expect(invalid.invalidUtf8).toBe(true);

		const blank = parseLogcatLine({ bytes: new Uint8Array(), endedWithLf: true, omittedBytes: 0 });
		expect(blank).toEqual({ kind: "control", control: "blank" });

		const marker = parseLogcatLine({
			bytes: new TextEncoder().encode("--------- beginning of main"),
			endedWithLf: true,
			omittedBytes: 0,
		});
		expect(marker).toEqual({ kind: "control", control: "buffer-marker" });

		const long = new Uint8Array(20);
		long.fill(0x61);
		long[10] = 0x0a;
		const truncated = frameBytes(emptyFramerState(), long, { eof: false, maxLineBytes: 4, maxLines: 4 });
		expect(truncated.lines[0]?.omittedBytes).toBeGreaterThan(0);
	});
});
