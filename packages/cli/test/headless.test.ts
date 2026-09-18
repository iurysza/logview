import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

	test("--semantic without TYPESAFE_API_KEY is exit 2", async () => {
		const previous = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
		const code = await main(["bun", "logview", "replay", "missing.lvr.jsonl", "--semantic"]);

		if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
		else process.env.TYPESAFE_API_KEY = previous;

		expect(code).toBe(2);
	});

	test("--config with semantic.enabled and no TYPESAFE_API_KEY is exit 2", async () => {
		const previous = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
		const dir = await mkdtemp(join(tmpdir(), "logview-cli-config-"));
		const path = join(dir, "logview.json");

		await writeFile(path, JSON.stringify({ semantic: { enabled: true } }));

		const code = await main(["bun", "logview", "replay", "missing.lvr.jsonl", "--config", path]);

		if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
		else process.env.TYPESAFE_API_KEY = previous;

		expect(code).toBe(2);
	});

	test("--no-semantic overrides a config that enables Jev", async () => {
		const previous = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
		const dir = await mkdtemp(join(tmpdir(), "logview-cli-config-"));
		const path = join(dir, "logview.json");

		await writeFile(path, JSON.stringify({ semantic: { enabled: true } }));

		const fixture = join(process.cwd(), "tests/fixtures/synthetic/hello.lvr.jsonl");

		const code = await main([
			"bun",
			"logview",
			"replay",
			fixture,
			"--headless",
			"--config",
			path,
			"--no-semantic",
		]);

		if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
		else process.env.TYPESAFE_API_KEY = previous;

		expect(code).toBe(0);
	});

	test("missing --config path is exit 2", async () => {
		const code = await main([
			"bun",
			"logview",
			"replay",
			"missing.lvr.jsonl",
			"--config",
			"no-such-logview.json",
		]);

		expect(code).toBe(2);
	});
});
