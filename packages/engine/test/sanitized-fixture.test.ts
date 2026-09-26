import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	createRecordingFiles,
	createReplaySource,
	createSession,
	decodeRecordingLine,
	defaultSessionOptions,
	emptyRecordingSequence,
	packetFromChunk,
	SANITIZED_REDACTION_VERSION,
	validateRecordingSequence,
} from "@logcayo/engine";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";
import { buildSanitizedRecordingBytes, sanitizedRecordingPath } from "../../../tests/fixtures/real/build-recording.ts";
import {
	SANITIZED_ADMITTED_EVENTS,
	SANITIZED_DATABASE_MATCHES,
	SANITIZED_LOGCAT,
	SANITIZED_UNPARSED_EVENTS,
} from "../../../tests/fixtures/real/sanitized-payload.ts";

describe("sanitized real-pattern fixture", () => {
	test("committed recording matches the builder and replays through the production pipeline", async () => {
		const path = sanitizedRecordingPath();
		const committed = readFileSync(path);
		const generated = buildSanitizedRecordingBytes();
		expect(Buffer.from(committed).equals(Buffer.from(generated))).toBe(true);

		const text = committed.toString("utf8");
		const lines = text.trimEnd().split("\n");
		let state = emptyRecordingSequence();
		const stdout: Uint8Array[] = [];

		for (const line of lines) {
			const decoded = decodeRecordingLine(line, 1);
			expect(decoded.ok).toBe(true);

			if (!decoded.ok) return;

			const next = validateRecordingSequence(state, decoded.value);
			expect(next.ok).toBe(true);

			if (!next.ok) return;

			state = next.value;

			if (decoded.value.kind === "header") {
				expect(decoded.value.provenance).toBe("sanitized-real");
				expect(decoded.value.redactionVersion).toBe(SANITIZED_REDACTION_VERSION);
				continue;
			}

			if (decoded.value.kind !== "chunk" || decoded.value.stream !== "stdout") continue;

			const packet = packetFromChunk(decoded.value);
			expect(packet.ok).toBe(true);

			if (packet.ok) stdout.push(packet.value.bytes);
		}

		expect(state.ended).toBe(true);
		expect(Buffer.concat(stdout).toString("utf8")).toBe(SANITIZED_LOGCAT);

		const scheduler = new ManualScheduler();

		const replay = createReplaySource(
			{ path, speed: { kind: "instant" }, allowPartial: false },
			{ files: createRecordingFiles(), scheduler },
		);

		expect(replay.ok).toBe(true);

		if (!replay.ok) return;

		const created = createSession(
			defaultSessionOptions({ sessionId: "sanitized-real", rows: 8, columns: 120 }),
			{ source: replay.value, scheduler },
		);

		expect(created.ok).toBe(true);

		if (!created.ok) return;

		created.value.start();
		await scheduler.runUntilIdle();
		await created.value.sourceDone;
		const snapshot = created.value.snapshot();
		expect(snapshot.stats.admittedEvents).toBe(SANITIZED_ADMITTED_EVENTS);
		expect(snapshot.stats.unparsedEvents).toBe(SANITIZED_UNPARSED_EVENTS);

		const cafe = created.value.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "café" },
		});

		expect(cafe.ok).toBe(true);
		await scheduler.runUntilIdle();
		const cafeSnap = created.value.snapshot();
		expect(cafeSnap.stats.matchedEvents).toBe(1);
		expect(cafeSnap.rows.some((row) => rowTextHas(row, "café"))).toBe(true);

		const escaped = created.value.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "stray sequence" },
		});

		expect(escaped.ok).toBe(true);
		await scheduler.runUntilIdle();
		const escapedSnap = created.value.snapshot();
		expect(escapedSnap.rows.some((row) => rowTextHas(row, "\u001b"))).toBe(false);
		expect(escapedSnap.rows.some((row) => rowTextHas(row, "^["))).toBe(true);

		const filtered = created.value.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: "Database", pid: null, text: "" },
		});

		expect(filtered.ok).toBe(true);
		await scheduler.runUntilIdle();
		expect(created.value.snapshot().stats.matchedEvents).toBe(SANITIZED_DATABASE_MATCHES);
		await created.value.stop();
	});
});

function rowTextHas(row: { spans: readonly { text: string }[] }, needle: string): boolean {
	let text = "";

	for (const span of row.spans) text += span.text;

	return text.includes(needle);
}
