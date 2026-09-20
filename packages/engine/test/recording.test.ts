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
	uidRecordingHeader,
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

		const session = createSession(defaultSessionOptions({ sessionId: "rec", sourceKind: "replay", rows: 8, columns: 80 }), {
			source: replay.value,
			scheduler: replayScheduler,
		});

		expect(session.ok).toBe(true);

		if (!session.ok) return;

		session.value.start();
		await replayScheduler.runUntilIdle();
		await session.value.sourceDone;
		expect(session.value.snapshot().stats.admittedEvents).toBe(2);
		expect(session.value.dispatch({ kind: "request-package-attribution" }).ok).toBe(true);
		expect(session.value.snapshot().packageAttribution).toEqual({ kind: "unavailable", reason: "not-recorded" });
		await session.value.stop();
	});

	test("replay resolves packages from the recording header without ADB", async () => {
		const dir = mkdtempSync(join(tmpdir(), "logview-record-"));
		const path = join(dir, "packages.lvr.jsonl");
		const source = new ScriptedSource();
		const scheduler = new ManualScheduler();

		const run = recordSession(
			source,
			{
				outPath: path,
				durationMs: null,
				maxFileBytes: 1024 * 1024,
				header: uidRecordingHeader([{ uid: 10123, packages: ["com.example.app"] }]),
			},
			{ files: new BunRecordingFiles(), scheduler },
			new AbortController().signal,
		);

		source.push(stdoutPacket(0, 0, "1760000000.000001  10123  1234  1250 I Tag: hello\n"));
		source.end();
		await scheduler.runUntilIdle();

		expect((await run).ok).toBe(true);

		const replayScheduler = new ManualScheduler();

		const replay = createReplaySource(
			{ path, speed: { kind: "instant" }, allowPartial: false },
			{ files: new BunRecordingFiles(), scheduler: replayScheduler },
		);

		if (!replay.ok) throw new Error(replay.error.message);

		const session = createSession(defaultSessionOptions({ sessionId: "packages", sourceKind: "replay", rows: 8, columns: 80 }), {
			source: replay.value,
			scheduler: replayScheduler,
		});

		if (!session.ok) throw new Error(session.error.message);

		session.value.start();
		await replayScheduler.runUntilIdle();
		await session.value.sourceDone;

		expect(session.value.dispatch({ kind: "request-package-attribution" }).ok).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(session.value.snapshot().packageAttribution).toEqual({
			kind: "resolved",
			uid: 10123,
			packages: ["com.example.app"],
		});
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
