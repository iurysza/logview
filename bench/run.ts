import { createSession, defaultSessionOptions } from "@logview/engine";
import { ManualScheduler } from "../tests/support/manual-scheduler.ts";
import { ScriptedSource } from "../tests/support/scripted-source.ts";
import { generateLines } from "./generate.ts";

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "headless";
const count = 1_000;
const source = new ScriptedSource();
const scheduler = new ManualScheduler();
const created = createSession(defaultSessionOptions({ sessionId: "bench", maxEvents: count, rows: 24, columns: 80 }), {
	source,
	scheduler,
});

if (!created.ok) {
	console.error(created.error.message);
	process.exit(2);
}

const started = performance.now();
created.value.start();
source.pushLine(generateLines(count).join("\n"), 0);
source.end();
await scheduler.runUntilIdle();
await created.value.sourceDone;
const elapsed = performance.now() - started;
const snapshot = created.value.snapshot();
await created.value.stop();

const result = {
	mode,
	count,
	elapsedMs: elapsed,
	admitted: snapshot.stats.admittedEvents,
	retained: snapshot.stats.retainedEvents,
	chargedHistoryBytes: snapshot.stats.chargedHistoryBytes,
	rowObjects: snapshot.rows.length,
};

process.stdout.write(`${JSON.stringify(result)}\n`);
