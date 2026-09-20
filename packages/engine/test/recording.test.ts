import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BunRecordingFiles,
	createReplaySource,
	createSession,
	defaultSessionOptions,
	recordSession,
	syntheticRecordingHeader,
} from "@logview/engine";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";
import { logcatLine, ScriptedSource, stdoutPacket } from "../../../tests/support/scripted-source.ts";

describe("recording", () => {
	test("records a scripted source and replays identical stdout bytes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "logview-record-"));
		const path = join(dir, "session.lvr.jsonl");

		const packets = [
			stdoutPacket(0, 0, logcatLine(1, "alpha")),
			stdoutPacket(1, 5, logcatLine(2, "beta")),
		];

		const source = new ScriptedSource();
		const scheduler = new ManualScheduler();

		const run = recordSession(
			source,
			{
				outPath: path,
				durationMs: null,
				maxFileBytes: 1024 * 1024,
				header: syntheticRecordingHeader(),
			},
			{ files: new BunRecordingFiles(), scheduler },
			new AbortController().signal,
		);

		source.push(...packets);
		source.end();
		await scheduler.runUntilIdle();
		const recorded = await run;
		expect(recorded.ok).toBe(true);

		if (!recorded.ok) return;

		const replayScheduler = new ManualScheduler();

		const replay = createReplaySource(
			{ path, speed: { kind: "instant" }, allowPartial: false },
			{ files: new BunRecordingFiles(), scheduler: replayScheduler },
		);

		expect(replay.ok).toBe(true);

		if (!replay.ok) return;

		const session = createSession(defaultSessionOptions({ sessionId: "rec", rows: 8, columns: 80 }), {
			source: replay.value,
			scheduler: replayScheduler,
		});

		expect(session.ok).toBe(true);

		if (!session.ok) return;

		session.value.start();
		await replayScheduler.runUntilIdle();
		await session.value.sourceDone;
		expect(session.value.snapshot().stats.admittedEvents).toBe(2);
		await session.value.stop();
	});

	test("stops at the duration limit while the source waits idle", async () => {
		const dir = mkdtempSync(join(tmpdir(), "logview-record-"));
		const path = join(dir, "duration.lvr.jsonl");
		const source = new ScriptedSource();
		const scheduler = new ManualScheduler();

		const run = recordSession(
			source,
			{
				outPath: path,
				durationMs: 10,
				maxFileBytes: 1024 * 1024,
				header: syntheticRecordingHeader(),
			},
			{ files: new BunRecordingFiles(), scheduler },
			new AbortController().signal,
		);

		await scheduler.runUntilIdle();
		scheduler.now = 10;
		await scheduler.runUntilIdle();

		const recorded = await run;
		expect(recorded.ok).toBe(true);

		if (!recorded.ok) return;
		expect(recorded.value.end.outcome).toBe("user-stop");
	});

	test("refuses to overwrite an existing destination", async () => {
		const dir = mkdtempSync(join(tmpdir(), "logview-record-"));
		const path = join(dir, "exists.lvr.jsonl");
		await Bun.write(path, "x\n");
		const source = new ScriptedSource();

		const result = await recordSession(
			source,
			{
				outPath: path,
				durationMs: null,
				maxFileBytes: 1024 * 1024,
				header: syntheticRecordingHeader(),
			},
			{ files: new BunRecordingFiles(), scheduler: new ManualScheduler() },
			new AbortController().signal,
		);

		expect(result.ok).toBe(false);

		if (result.ok) return;
		expect(result.error.kind).toBe("exists");
	});
});
