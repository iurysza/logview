import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MAX_EVENTS, DEFAULT_MAX_HISTORY_CHARGE_BYTES } from "@logview/core";
import { benchEnvironment, measureSession, type BenchMode, type BenchMeasurement } from "./session-bench.ts";

const DEFAULT_COUNT = 2_000;

const FULL_COUNT = 100_000;

const FILTER_CHARGE_BYTES = 128 * 1024 * 1024;

type BenchReport = Readonly<{
	advisoryTimings: true;
	fullScale: boolean;
	environment: ReturnType<typeof benchEnvironment>;
	measurements: readonly BenchMeasurement[];
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

function readCount(argv: readonly string[], fullScale: boolean): number {
	const fromArg = readFlag(argv, "--count");
	const raw = fromArg ?? process.env.BENCH_COUNT ?? String(fullScale ? FULL_COUNT : DEFAULT_COUNT);
	const count = Number(raw);

	if (!Number.isSafeInteger(count) || count < 1) return DEFAULT_COUNT;

	return count;
}

async function main(): Promise<void> {
	const mode = readMode(process.argv);
	const fullScale = process.argv.includes("--full");
	const count = readCount(process.argv, fullScale);
	const columns = 80;
	const rows = 24;
	const outPath = readFlag(process.argv, "--out");
	const ingestCount = count;
	const filterCount = fullScale ? FULL_COUNT : Math.min(count, 8_000);
	const filterCharge = fullScale ? FILTER_CHARGE_BYTES : DEFAULT_MAX_HISTORY_CHARGE_BYTES;

	const ingest = await measureSession({
		mode,
		workload: "ingest",
		count: ingestCount,
		maxEvents: Math.max(ingestCount, DEFAULT_MAX_EVENTS),
		maxHistoryChargeBytes: DEFAULT_MAX_HISTORY_CHARGE_BYTES,
		columns,
		rows,
		filterText: null,
		moves: 0,
	});

	const burst = await measureSession({
		mode,
		workload: "burst",
		count: fullScale ? 50_000 : Math.min(count, 5_000),
		maxEvents: fullScale ? 50_000 : Math.min(count, 5_000),
		maxHistoryChargeBytes: DEFAULT_MAX_HISTORY_CHARGE_BYTES,
		columns,
		rows,
		filterText: null,
		moves: 0,
	});

	const filter = await measureSession({
		mode,
		workload: "filter-replace",
		count: filterCount,
		maxEvents: filterCount,
		maxHistoryChargeBytes: filterCharge,
		columns,
		rows,
		filterText: "KEEP",
		moves: 32,
	});

	const report: BenchReport = {
		advisoryTimings: true,
		fullScale,
		environment: benchEnvironment(columns, rows),
		measurements: [ingest, burst, filter],
	};

	const json = `${JSON.stringify(report)}\n`;
	process.stdout.write(json);

	if (outPath !== null) {
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, json);
	}
}

await main();
