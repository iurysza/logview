import { cpus, release, totalmem } from "node:os";
import { createSession, defaultSessionOptions } from "@logcayo/engine";
import { ManualScheduler } from "../tests/support/manual-scheduler.ts";
import { ScriptedSource } from "../tests/support/scripted-source.ts";
import { BENCH_SEED, generateLines, PRD_SIZE_PLAN } from "./generate.ts";

export type BenchMode = "headless" | "tui";

export type BenchEnvironment = Readonly<{
	bun: string;
	platform: string;
	arch: string;
	osRelease: string;
	cpuModel: string;
	cpuCount: number;
	totalMemBytes: number;
	columns: number;
	rows: number;
}>;

export type BenchMeasurement = Readonly<{
	ok: true;
	mode: BenchMode;
	workload: string;
	seed: number;
	count: number;
	medianBytes: number;
	p95Bytes: number;
	elapsedMs: number;
	admitted: number;
	retained: number;
	chargedHistoryBytes: number;
	rowObjects: number;
	matchedEvents: number;
	queuedBytes: number;
	rssBytes: number;
	heapUsedBytes: number;
	filterMs: number | null;
	moveP95Ms: number | null;
	visibleRowBudget: number;
}>;

export function benchEnvironment(columns: number, rows: number): BenchEnvironment {
	const list = cpus();

	return {
		bun: Bun.version,
		platform: process.platform,
		arch: process.arch,
		osRelease: release(),
		cpuModel: list[0]?.model ?? "unknown",
		cpuCount: list.length,
		totalMemBytes: totalmem(),
		columns,
		rows,
	};
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;

	const sorted = values.slice().sort((left, right) => left - right);
	const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));

	return sorted[rank] ?? 0;
}

export async function measureSession(args: {
	mode: BenchMode;
	workload: string;
	count: number;
	maxEvents: number;
	maxHistoryChargeBytes: number;
	columns: number;
	rows: number;
	filterText: string | null;
	moves: number;
}): Promise<BenchMeasurement> {
	const source = new ScriptedSource();
	const scheduler = new ManualScheduler();

	const created = createSession(
		defaultSessionOptions({
			sessionId: `bench-${args.workload}`,
			maxEvents: args.maxEvents,
			maxHistoryChargeBytes: args.maxHistoryChargeBytes,
			rows: args.rows,
			columns: args.columns,
		}),
		{ source, scheduler },
	);

	if (!created.ok) throw new Error(created.error.message);

	const session = created.value;
	const started = session.start();

	if (!started.ok) throw new Error(started.error.kind);

	const lines = generateLines(args.count, BENCH_SEED, PRD_SIZE_PLAN);
	const startedAt = performance.now();

	for (let index = 0; index < lines.length; index += 1) {
		source.pushLine(lines[index]!, index);
	}

	source.end();
	await scheduler.runUntilIdle();
	await session.sourceDone;

	let filterMs: number | null = null;

	if (args.filterText !== null) {
		const filterStarted = performance.now();

		const dispatched = session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: args.filterText },
		});

		if (!dispatched.ok) throw new Error(dispatched.error.message);

		await scheduler.runUntilIdle();
		filterMs = performance.now() - filterStarted;
	}

	const moveSamples: number[] = [];

	for (let i = 0; i < args.moves; i += 1) {
		const moveStarted = performance.now();
		session.dispatch({ kind: "move", delta: -1 });
		moveSamples.push(performance.now() - moveStarted);
	}

	const elapsedMs = performance.now() - startedAt;
	const snapshot = session.snapshot();
	await session.stop();
	const memory = process.memoryUsage();

	return {
		ok: true,
		mode: args.mode,
		workload: args.workload,
		seed: BENCH_SEED,
		count: args.count,
		medianBytes: PRD_SIZE_PLAN.medianBytes,
		p95Bytes: PRD_SIZE_PLAN.p95Bytes,
		elapsedMs,
		admitted: snapshot.stats.admittedEvents,
		retained: snapshot.stats.retainedEvents,
		chargedHistoryBytes: snapshot.stats.chargedHistoryBytes,
		rowObjects: snapshot.rows.length,
		matchedEvents: snapshot.stats.matchedEvents,
		queuedBytes: snapshot.stats.queuedBytes,
		rssBytes: memory.rss,
		heapUsedBytes: memory.heapUsed,
		filterMs,
		moveP95Ms: args.moves > 0 ? percentile(moveSamples, 95) : null,
		visibleRowBudget: Math.max(0, args.rows - 3),
	};
}
