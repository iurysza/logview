import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Either, Schema } from "effect";
import {
	createRecordingFiles,
	createReplaySource,
	createScheduler,
	createSession,
	defaultSessionOptions,
} from "@logview/engine";
import { main } from "../src/main.ts";
import { runHeadless } from "../src/headless.ts";

const Summary = Schema.parseJson(
	Schema.Struct({
		version: Schema.Literal(1),
		kind: Schema.Literal("summary"),
		terminal: Schema.Struct({
			kind: Schema.String,
		}),
		snapshot: Schema.Struct({
			stats: Schema.Struct({
				admittedEvents: Schema.Number,
			}),
		}),
	}),
);

describe("headless CLI", () => {
	test("replay --headless emits a JSON summary and does not load OpenTUI", async () => {
		const fixture = join(process.cwd(), "tests/fixtures/synthetic/hello.lvr.jsonl");
		const scheduler = createScheduler();

		const replay = createReplaySource(
			{ path: fixture, speed: { kind: "instant" }, allowPartial: false },
			{ files: createRecordingFiles(), scheduler },
		);

		expect(replay.ok).toBe(true);

		if (!replay.ok) return;

		const session = createSession(
			defaultSessionOptions({ sessionId: "cli-headless", rows: 8, columns: 80 }),
			{
				source: replay.value,
				scheduler,
			},
		);

		expect(session.ok).toBe(true);

		if (!session.ok) return;

		const lines: string[] = [];

		const code = await runHeadless(session.value, (line) => {
			lines.push(line);
		});

		expect(code).toBe(0);

		const decoded = Schema.decodeEither(Summary)(lines[0] ?? "{}");

		Either.match(decoded, {
			onLeft: (error) => {
				throw new Error(error.message);
			},
			onRight: (value) => {
				expect(value.kind).toBe("summary");
				expect(value.version).toBe(1);
				expect(value.snapshot.stats.admittedEvents).toBeGreaterThanOrEqual(1);
			},
		});
	});

	test("missing replay path is exit 2", async () => {
		const code = await main(["bun", "logview", "replay"]);

		expect(code).toBe(2);
	});
});
