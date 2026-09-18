import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToBase64, encodeRecordingRecord, syntheticRecordingHeader } from "@logview/engine";
import { main } from "../src/main.ts";

function recordingWithLine(message: string): string {
	const header = new TextDecoder().decode(encodeRecordingRecord(syntheticRecordingHeader()));
	const line = `1760000000.000001  1234  1250 I Tag: ${message}\n`;
	const chunk = new TextDecoder().decode(
		encodeRecordingRecord({
			kind: "chunk",
			packetSeq: 0,
			offsetMs: 0,
			stream: "stdout",
			base64: bytesToBase64(new TextEncoder().encode(line)),
		}),
	);
	const end = new TextDecoder().decode(
		encodeRecordingRecord({ kind: "end", chunks: 1, outcome: "eof", error: null }),
	);
	return `${header}${chunk}${end}`;
}

describe("headless CLI", () => {
	test("replay --headless prints a JSON summary and does not load OpenTUI", async () => {
		const dir = mkdtempSync(join(tmpdir(), "logview-cli-"));
		const path = join(dir, "one.lvr.jsonl");
		await Bun.write(path, recordingWithLine("hello-headless"));
		const lines: string[] = [];
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
			return true;
		}) as typeof process.stdout.write;

		try {
			const code = await main(["bun", "logview", "replay", path, "--speed", "instant", "--headless"]);
			expect(code).toBe(0);
		} finally {
			process.stdout.write = originalWrite;
		}

		const jsonLine = lines.join("").trim().split("\n").at(-1);
		expect(jsonLine).toBeTruthy();
		const parsed = JSON.parse(jsonLine!);
		expect(parsed.version).toBe(1);
		expect(parsed.kind).toBe("summary");
		expect(parsed.terminal.kind).toBe("ended");
		expect(parsed.snapshot.stats.admittedEvents).toBe(1);
	});

	test("unknown commands return exit 2", async () => {
		const code = await main(["bun", "logview", "nope"]);
		expect(code).toBe(2);
	});
});
