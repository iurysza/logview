import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	createRecordingFiles,
	createReplaySource,
	createSession,
	decodeRecordingLine,
	defaultSessionOptions,
	emptyRecordingSequence,
	SANITIZED_REDACTION_VERSION,
	validateRecordingSequence,
} from "@logview/engine";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";
import {
	buildSanitizedDeviceSampleBytes,
	SANITIZED_DEVICE_SAMPLE_REDACTION_VERSION,
	sanitizedDeviceSamplePath,
} from "../../../tests/fixtures/real/build-sanitized-device-sample.ts";

describe("sanitized device sample fixture", () => {
	test("matches its builder and replays 500 safe log events", async () => {
		const path = sanitizedDeviceSamplePath();
		const committed = readFileSync(path);
		const generated = buildSanitizedDeviceSampleBytes();
		expect(Buffer.from(committed).equals(Buffer.from(generated))).toBe(true);

		let state = emptyRecordingSequence();

		for (const line of committed.toString("utf8").trimEnd().split("\n")) {
			const decoded = decodeRecordingLine(line, 1);
			expect(decoded.ok).toBe(true);

			if (!decoded.ok) return;

			const next = validateRecordingSequence(state, decoded.value);
			expect(next.ok).toBe(true);

			if (!next.ok) return;

			state = next.value;

			if (decoded.value.kind === "header") {
				expect(decoded.value.provenance).toBe("sanitized-real");
				expect(decoded.value.redactionVersion).toBe(SANITIZED_DEVICE_SAMPLE_REDACTION_VERSION);
				expect(decoded.value.redactionVersion).not.toBe(SANITIZED_REDACTION_VERSION);
			}
		}

		expect(state.ended).toBe(true);

		const scheduler = new ManualScheduler();

		const replay = createReplaySource(
			{ path, speed: { kind: "instant" }, allowPartial: false },
			{ files: createRecordingFiles(), scheduler },
		);

		expect(replay.ok).toBe(true);

		if (!replay.ok) return;

		const created = createSession(
			defaultSessionOptions({ sessionId: "sanitized-device-sample", rows: 8, columns: 120 }),
			{ source: replay.value, scheduler },
		);

		expect(created.ok).toBe(true);

		if (!created.ok) return;

		created.value.start();
		await scheduler.runUntilIdle();
		await created.value.sourceDone;

		const snapshot = created.value.snapshot();
		expect(snapshot.stats.admittedEvents).toBe(500);
		expect(snapshot.stats.unparsedEvents).toBe(7);

		const filtered = created.value.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: "Component01", pid: null, text: "" },
		});

		expect(filtered.ok).toBe(true);
		await scheduler.runUntilIdle();
		expect(created.value.snapshot().stats.matchedEvents).toBe(30);
		await created.value.stop();
	});
});
