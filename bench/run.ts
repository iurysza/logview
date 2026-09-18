import { createSession, defaultSessionOptions } from "@logview/engine";
import { ManualScheduler } from "../tests/support/manual-scheduler.ts";
import { ScriptedSource } from "../tests/support/scripted-source.ts";
import { generateLines } from "./generate.ts";

const DEFAULT_COUNT = 1_000;
const SEED = 20260918;

type BenchMode = "headless" | "tui";

type BenchResult = Readonly<{
	ok: true;
	mode: BenchMode;
	seed: number;
	count: number;
	elapsedMs: number;
	admitted: number;
	retained: number;
	chargedHistoryBytes: number;
	rowObjects: number;
	matchedEvents: number;
	queuedBytes: number;
}>;

function readFlag(argv: readonly string[], flag: string): string | null {
	const index = argv.indexOf(flag);

	if (index < 0) return null;

	return argv[index + 1] ?? null;
}

function readMode(argv: readonly string[]): BenchMode {
	const value = readFlag(argv, "--mode");

	if (value === "tui") return "tui";

	return "headless";
}

function readCount(argv: readonly string[]): number {
	const fromArg = readFlag(argv, "--count");
	const raw = fromArg ?? process.env.BENCH_COUNT ?? String(DEFAULT_COUNT);
	const count = Number(raw);

	if (!Number.isSafeInteger(count) || count < 1) return DEFAULT_COUNT;

	return count;
}

async function main(): Promise<void> {
	const mode = readMode(process.argv);
	const count = readCount(process.argv);
	const source = new ScriptedSource();
	const scheduler = new ManualScheduler();
	const created = createSession(
		defaultSessionOptions({
			sessionId: "bench",
			maxEvents: count,
			rows: 24,
			columns: 80,
		}),
		{
			source,
			scheduler,
		},
	);

	if (!created.ok) {
		process.stderr.write(`${created.error.message}\n`);
		process.exitCode = 2;

		return;
	}

	const session = created.value;
	const startedAt = performance.now();
	const started = session.start();

	if (!started.ok) {
		process.stderr.write(`failed to start: ${started.error.kind}\n`);
		process.exitCode = 1;

		return;
	}

	const lines = generateLines(count, SEED);

	for (let index = 0; index < lines.length; index += 1) {
		source.pushLine(lines[index]!, index);
	}

	source.end();
	await scheduler.runUntilIdle();
	await session.sourceDone;
	const elapsedMs = performance.now() - startedAt;
	const snapshot = session.snapshot();
	await session.stop();

	const result: BenchResult = {
		ok: true,
		mode,
		seed: SEED,
		count,
		elapsedMs,
		admitted: snapshot.stats.admittedEvents,
		retained: snapshot.stats.retainedEvents,
		chargedHistoryBytes: snapshot.stats.chargedHistoryBytes,
		rowObjects: snapshot.rows.length,
		matchedEvents: snapshot.stats.matchedEvents,
		queuedBytes: snapshot.stats.queuedBytes,
	};

	process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main();
