import { formatFilterQuery, messageText, parseFilterQuery, tagText, type LogEvent, type SourceKind } from "@logview/core";
import {
	createAdbPackageResolver,
	createAdbSource,
	createProcessRunner,
	createRecordingFiles,
	createReplaySource,
	createScheduler,
	createSession,
	defaultSessionOptions,
	type Session,
	type SourceTerminal,
} from "@logview/engine";

export type QueryWriter = Readonly<{
	stdout(line: string): void;
	stderr(line: string): void;
}>;

const defaultWriter: QueryWriter = {
	stdout: (line) => { process.stdout.write(`${line}\n`); },
	stderr: (line) => { process.stderr.write(`${line}\n`); },
};

type QueryOptions = Readonly<{
	path: string | null;
	live: boolean;
	check: boolean;
	query: string;
	limit: number | null;
	sinceMicros: number | null;
	format: "ndjson" | "text";
	allowPartial: boolean;
	serial: string | null;
	adbPath: string;
	timeoutMs: number | null;
}>;

const help = `logview query — stream matching events without opening the TUI

Usage:
  logview query PATH [QUERY] [--limit N] [--since TIME] [--format ndjson|text] [--allow-partial]
  logview query --live [QUERY] [--serial S] [--adb PATH] [--timeout DUR] [--limit N] [--since TIME|DUR]
  logview query --check QUERY

Query: terms separated by spaces. level:V|D|I|W|E|F|ALL, tag:NAME,
       pid:POSITIVE_INTEGER, pkg:NAME; other terms search text. Quote terms
       with spaces or terms that look like keys. Repeated keys are invalid.
TIME: ISO-8601 with timezone or epoch seconds; relative 30s, 5m, 2h for --live only.
DUR: positive duration in ms, s, m, or h. Live timeout defaults to 10s.

Examples:
  logview query capture.lvr.jsonl 'level:W tag:Database lock'
  logview query --live 'pid:4321' --timeout 5s --limit 20
  logview query --check 'level:e database'

Exit codes: 0 success (including zero matches); 1 source failure; 2 invalid arguments/query.`;

function error(writer: QueryWriter, kind: "source-failure", field: string, message: string, offset?: number | null): 1;
function error(writer: QueryWriter, kind: string, field: string, message: string, offset?: number | null): 2;
function error(writer: QueryWriter, kind: string, field: string, message: string, offset: number | null = null): 1 | 2 {
	writer.stderr(JSON.stringify({ v: 1, type: "error", kind, field, message, offset }));

	return kind === "source-failure" ? 1 : 2;
}

function duration(value: string): number | null {
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);

	if (!match) return null;
	const unit = match[2];
	let multiplier = 1;

	if (unit === "s") multiplier = 1000;
	else if (unit === "m") multiplier = 60_000;
	else if (unit === "h") multiplier = 3_600_000;

	const ms = Number(match[1]) * multiplier;

	return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

function since(value: string, live: boolean, now: number): number | null {
	const relative = duration(value);

	if (relative !== null) return live ? (now - relative) * 1000 : null;

	if (/^\d+(?:\.\d+)?$/.test(value)) {
		const micros = Number(value) * 1_000_000;

		return Number.isSafeInteger(micros) ? micros : null;
	}

	if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
	const millis = Date.parse(value);

	return Number.isFinite(millis) ? millis * 1000 : null;
}

function parse(args: readonly string[], now: number, writer: QueryWriter): QueryOptions | 2 {
	let path: string | null = null;
	let query: string | null = null;
	let live = false;
	let check = false;
	let limit: number | null = null;
	let sinceValue: string | null = null;
	let format: "ndjson" | "text" = "ndjson";
	let allowPartial = false;
	let serial: string | null = null;
	let adbPath = process.env.ADB ?? "adb";
	let timeoutMs: number | null = null;
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;

		if (arg === "--live") { live = true; continue; }

		if (arg === "--check") { check = true; continue; }

		if (arg === "--allow-partial") { allowPartial = true; continue; }

		if (["--limit", "--since", "--format", "--serial", "--adb", "--timeout"].includes(arg)) {
			const value = args[++i];

			if (value === undefined || value.startsWith("--")) return error(writer, "invalid-argument", arg, `missing value for ${arg}`);

			if (arg === "--limit") {
				limit = Number(value);

				if (!Number.isSafeInteger(limit) || limit < 1) return error(writer, "invalid-argument", arg, "limit must be a positive integer");
			} else if (arg === "--since") sinceValue = value;
			else if (arg === "--format") {
				if (value !== "ndjson" && value !== "text") return error(writer, "invalid-argument", arg, "format must be ndjson or text");
				format = value;
			} else if (arg === "--serial") serial = value;
			else if (arg === "--adb") adbPath = value;
			else {
				timeoutMs = duration(value);

				if (timeoutMs === null) return error(writer, "invalid-argument", arg, "timeout must be a positive duration (ms, s, m, h)");
			}

			continue;
		}

		if (arg.startsWith("-")) return error(writer, "invalid-argument", arg, `unknown option ${arg}`);
		positional.push(arg);
	}

	if (check) {
		if (live || positional.length !== 1 || limit !== null || sinceValue !== null || timeoutMs !== null || serial !== null || allowPartial || format !== "ndjson" || adbPath !== (process.env.ADB ?? "adb")) {
			return error(writer, "invalid-argument", "--check", "--check requires exactly one QUERY and no other options");
		}

		query = positional[0]!;
	} else if (live) {
		if (positional.length > 1 || allowPartial) return error(writer, "invalid-argument", "query", "--live takes one optional QUERY and no --allow-partial");
		query = positional[0] ?? "";
		timeoutMs ??= 10_000;
	} else {
		if (positional.length < 1 || positional.length > 2) return error(writer, "invalid-argument", "path", "query requires PATH and at most one QUERY");

		if (serial !== null || timeoutMs !== null || adbPath !== (process.env.ADB ?? "adb")) return error(writer, "invalid-argument", "path", "live-only options require --live");
		path = positional[0]!;
		query = positional[1] ?? "";
	}

	const sinceMicros = sinceValue === null ? null : since(sinceValue, live, now);

	if (sinceValue !== null && sinceMicros === null) return error(writer, "invalid-argument", "--since", "since must be an absolute ISO-8601 time or epoch seconds; relative durations require --live");

	return { path, live, check, query, limit, sinceMicros, format, allowPartial, serial, adbPath, timeoutMs };
}

function eventLine(event: LogEvent): string {
	const metadata = event.metadata;

	return JSON.stringify({
		v: 1, type: "event", id: event.id,
		time: metadata === null ? null : new Date(Math.trunc(metadata.epochMicros / 1000)).toISOString(),
		epochMicros: metadata?.epochMicros ?? null,
		level: metadata?.level ?? null, pid: metadata?.pid ?? null, tid: metadata?.tid ?? null,
		uid: metadata?.uid ?? null,
		tag: metadata ? tagText(event.rawText, metadata.tag) : null,
		message: metadata ? messageText(event.rawText, metadata.message) : null,
		raw: event.rawText, continuations: event.continuations,
	});
}

async function stream(session: Session, options: QueryOptions, canonical: string, writer: QueryWriter): Promise<number> {
	let cursor: number | null = null;
	let emitted = 0;
	let evictedBeforeRead = 0;
	let previousEvicted = 0;
	let stop: "eof" | "limit" | "timeout" | "signal" | null = null;
	let wake: (() => void) | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const notify = (): void => { wake?.(); };

	const onSignal = (): void => { stop = "signal"; notify(); };

	const unsubscribe = session.subscribe(notify);
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	if (options.timeoutMs !== null) timer = setTimeout(() => { stop = "timeout"; notify(); }, options.timeoutMs);

	try {
		const started = session.start();

		if (!started.ok) return error(writer, "source-failure", "source", started.error.kind);

		while (stop === null) {
			// The active index may have pruned events before this reader reached them.
			// IDs include non-matches: this is an upper bound, not an exact matched count.
			const snapshot = session.snapshot();
			const skipped = Math.max(0, snapshot.stats.evictedEvents - Math.max(cursor ?? 0, previousEvicted));
			evictedBeforeRead += skipped;
			previousEvicted = snapshot.stats.evictedEvents;
			let batch = session.readMatches(cursor, 512);

			while (batch.length > 0 && stop === null) {
				for (const event of batch) {
					cursor = event.id;

					if (options.sinceMicros !== null && (event.metadata?.epochMicros ?? -Infinity) < options.sinceMicros) continue;

					if (options.format === "text") {
						writer.stdout(event.rawText);

						for (const continuation of event.continuations) writer.stdout(continuation);
					} else writer.stdout(eventLine(event));
					emitted++;

					if (emitted === options.limit) { stop = "limit"; break; }
				}

				if (stop === null) batch = session.readMatches(cursor, 512);
			}

			if (stop !== null) break;
			const current = session.snapshot();

			if ((current.source.kind === "ended" || current.source.kind === "failed") && current.pendingFilter === null && session.readMatches(cursor, 1).length === 0) {
				stop = "eof";
				break;
			}

			await new Promise<void>((resolve) => {
				wake = resolve;
				// Recheck after registering to avoid losing a publish between reads.
				const latest = session.snapshot();

				if (stop !== null || latest.revision !== current.revision) resolve();
			});
			wake = null;
		}

		// One final read after the stop trigger. Limit remains a strict output bound.
		if (emitted !== options.limit) {
			let batch = session.readMatches(cursor, 512);

			while (batch.length > 0) {
				for (const event of batch) {
					cursor = event.id;

					if (options.sinceMicros !== null && (event.metadata?.epochMicros ?? -Infinity) < options.sinceMicros) continue;

					if (options.format === "text") {
						writer.stdout(event.rawText);

						for (const continuation of event.continuations) writer.stdout(continuation);
					} else writer.stdout(eventLine(event));
					emitted++;

					if (emitted === options.limit) break;
				}

				if (emitted === options.limit) break;
				batch = session.readMatches(cursor, 512);
			}
		}

		const snapshot = session.snapshot();
		const terminal: SourceTerminal | null = snapshot.source.kind === "ended" || snapshot.source.kind === "failed" ? snapshot.source : null;

		const summary = {
			v: 1, type: "summary", query: canonical, emitted, matched: snapshot.stats.matchedEvents,
			stop, terminal, evictedBeforeRead,
		};

		const output = options.timeoutMs === null ? summary : { ...summary, timeout_ms: options.timeoutMs };

		(options.format === "text" ? writer.stderr : writer.stdout)(JSON.stringify(output));

		if (terminal?.kind === "failed") {
			return error(writer, "source-failure", "source", terminal.error.message);
		}

		return 0;
	} finally {
		if (timer !== null) clearTimeout(timer);
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		unsubscribe();
		await session.stop();
	}
}

export async function runQuery(args: readonly string[], writer: QueryWriter = defaultWriter): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		writer.stdout(help);

		return 0;
	}

	const options = parse(args, Date.now(), writer);

	if (options === 2) return 2;
	const parsed = parseFilterQuery(options.query);

	if (!parsed.ok) return error(writer, parsed.error.kind, parsed.error.field, parsed.error.message, parsed.error.offset);
	const canonical = formatFilterQuery(parsed.value);

	if (options.check) {
		writer.stdout(JSON.stringify({ v: 1, type: "check", query: canonical, filter: parsed.value }));

		return 0;
	}

	const scheduler = createScheduler();
	const sourceKind: SourceKind = options.live ? "live" : "replay";
	const processes = options.live ? createProcessRunner() : null;

	const replay = options.path === null ? null : createReplaySource(
		{ path: options.path, speed: { kind: "instant" }, allowPartial: options.allowPartial },
		{ files: createRecordingFiles(), scheduler },
	);

	if (replay && !replay.ok) return error(writer, "invalid-argument", "path", replay.error.message);

	const source = processes
		? createAdbSource({ adbPath: options.adbPath, serial: options.serial }, { processes, scheduler })
		: replay?.ok ? replay.value : null;

	if (source === null) return error(writer, "invalid-argument", "path", "query requires a source");

	const packageResolver = processes
		? createAdbPackageResolver({ adbPath: options.adbPath, serial: options.serial }, { processes })
		: undefined;

	const created = createSession(defaultSessionOptions({
		sessionId: `query-${Date.now()}`, sourceKind, label: options.path ?? options.serial ?? "adb", initialFilter: parsed.value,
	}), { source, scheduler, packageResolver });

	if (!created.ok) return error(writer, "invalid-argument", created.error.field, created.error.message);

	return stream(created.value, options, canonical, writer);
}
