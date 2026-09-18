import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createRecordingFiles,
	createReplaySource,
	createSession,
	defaultSessionOptions,
	recordSession,
	syntheticRecordingHeader,
} from "@logview/engine";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";
import { ScriptedSource } from "../../../tests/support/scripted-source.ts";
import { threadtimeLine } from "../../../tests/support/log-lines.ts";
import { tick } from "../../../tests/support/scenario.ts";

describe("replay", () => {
	test("replay of a synthetic recording matches direct packet delivery", async () => {
		const directory = await mkdtemp(join(tmpdir(), "logview-replay-"));
		const outPath = join(directory, "cap.lvr.jsonl");
		const recordedSource = new ScriptedSource();
		recordedSource.pushLine(threadtimeLine(1), 0);
		recordedSource.pushLine(threadtimeLine(2), 5);
		recordedSource.end();
		const recorded = await recordSession(
			recordedSource,
			{
				outPath,
				durationMs: null,
				maxFileBytes: 1024 * 1024,
				header: syntheticRecordingHeader(),
			},
			{ files: createRecordingFiles(), scheduler: new ManualScheduler() },
			new AbortController().signal,
		);
		expect(recorded.ok).toBe(true);

		const scheduler = new ManualScheduler();
		const replay = createReplaySource(
			{ path: outPath, speed: { kind: "instant" }, allowPartial: false },
			{ files: createRecordingFiles(), scheduler },
		);
		expect(replay.ok).toBe(true);
		if (!replay.ok) return;

		const session = createSession(defaultSessionOptions({ sessionId: "replay", maxEvents: 16, rows: 8 }), {
			source: replay.value,
			scheduler,
		});
		expect(session.ok).toBe(true);
		if (!session.ok) return;
		expect(session.value.start().ok).toBe(true);
		await session.value.sourceDone;
		await tick(scheduler);
		const snapshot = session.value.snapshot();
		expect(snapshot.stats.admittedEvents).toBe(2);
		expect(snapshot.view.selectedId).toBe(2);
		await session.value.stop();
	});
});
