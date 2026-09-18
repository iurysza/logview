import { EMPTY_FILTER, err, ok, type FilterSpec, type Result } from "@logview/core";
import {
	createAdbSource,
	createProcessRunner,
	createRecordingFiles,
	createReplaySource,
	createScheduler,
	createSession,
	defaultSessionOptions,
	DEFAULT_MAX_RECORDING_BYTES,
	type Session,
} from "@logview/engine";
import { runHeadless } from "./headless.ts";
import { runRecord } from "./record.ts";

type CliError = { exit: 1 | 2; message: string };

type ParsedCli =
	| {
			command: "live";
			serial: string | null;
			adbPath: string;
			headless: boolean;
			allowPartial: boolean;
			columns: number;
			rows: number;
			maxEvents: number | null;
			filter: FilterSpec;
	  }
	| {
			command: "replay";
			path: string;
			speed: { kind: "timed"; multiplier: number } | { kind: "instant" };
			headless: boolean;
			allowPartial: boolean;
			columns: number;
			rows: number;
			maxEvents: number | null;
			filter: FilterSpec;
	  }
	| {
			command: "record";
			serial: string | null;
			adbPath: string;
			outPath: string;
			durationSec: number | null;
			maxFileBytes: number;
	  }
	| { command: "help" };

function usage(): string {
	return `logview — keyboard-driven Android log viewer

Usage:
  logview live [--serial DEVICE] [--headless]
  logview record --out PATH [--serial DEVICE] [--duration SEC]
  logview replay PATH [--speed N|instant] [--headless] [--allow-partial]

Capture profile:
  adb -s <serial> logcat -b main -b system -b crash -v threadtime -v epoch -v usec *:V
`;
}

function takeValue(args: string[], index: number, field: string): Result<string, CliError> {
	const value = args[index];
	if (value === undefined) return err({ exit: 2, message: `missing value for ${field}` });
	return ok(value);
}

function parseArgs(argv: string[]): Result<ParsedCli, CliError> {
	const args = argv.slice(2);
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
		return ok({ command: "help" });
	}
	const command = args[0];
	const rest = args.slice(1);
	let serial: string | null = null;
	let adbPath = process.env.ADB ?? "adb";
	let headless = false;
	let allowPartial = false;
	let columns = 80;
	let rows = 24;
	let maxEvents: number | null = null;
	let outPath: string | null = null;
	let durationSec: number | null = null;
	let maxFileBytes = DEFAULT_MAX_RECORDING_BYTES;
	let speed: { kind: "timed"; multiplier: number } | { kind: "instant" } = { kind: "timed", multiplier: 1 };
	let path: string | null = null;
	const filter: FilterSpec = { ...EMPTY_FILTER };

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i]!;
		if (arg === "--headless") {
			headless = true;
			continue;
		}
		if (arg === "--allow-partial") {
			allowPartial = true;
			continue;
		}
		if (arg === "--serial") {
			const value = takeValue(rest, ++i, "--serial");
			if (!value.ok) return value;
			serial = value.value;
			continue;
		}
		if (arg === "--adb") {
			const value = takeValue(rest, ++i, "--adb");
			if (!value.ok) return value;
			adbPath = value.value;
			continue;
		}
		if (arg === "--out") {
			const value = takeValue(rest, ++i, "--out");
			if (!value.ok) return value;
			outPath = value.value;
			continue;
		}
		if (arg === "--duration") {
			const value = takeValue(rest, ++i, "--duration");
			if (!value.ok) return value;
			const n = Number(value.value);
			if (!Number.isFinite(n) || n <= 0) return err({ exit: 2, message: "duration must be a positive number of seconds" });
			durationSec = n;
			continue;
		}
		if (arg === "--max-bytes") {
			const value = takeValue(rest, ++i, "--max-bytes");
			if (!value.ok) return value;
			const n = Number(value.value);
			if (!Number.isSafeInteger(n) || n < 1) return err({ exit: 2, message: "max-bytes must be a positive integer" });
			maxFileBytes = n;
			continue;
		}
		if (arg === "--speed") {
			const value = takeValue(rest, ++i, "--speed");
			if (!value.ok) return value;
			if (value.value === "instant") {
				speed = { kind: "instant" };
			} else {
				const n = Number(value.value);
				if (!Number.isFinite(n) || n <= 0) return err({ exit: 2, message: "speed must be instant or a positive number" });
				speed = { kind: "timed", multiplier: n };
			}
			continue;
		}
		if (arg === "--columns") {
			const value = takeValue(rest, ++i, "--columns");
			if (!value.ok) return value;
			columns = Number(value.value);
			continue;
		}
		if (arg === "--rows") {
			const value = takeValue(rest, ++i, "--rows");
			if (!value.ok) return value;
			rows = Number(value.value);
			continue;
		}
		if (arg === "--max-events") {
			const value = takeValue(rest, ++i, "--max-events");
			if (!value.ok) return value;
			maxEvents = Number(value.value);
			continue;
		}
		if (arg === "--filter-text") {
			const value = takeValue(rest, ++i, "--filter-text");
			if (!value.ok) return value;
			filter.text = value.value;
			continue;
		}
		if (arg.startsWith("-")) return err({ exit: 2, message: `unknown option ${arg}` });
		if (command === "replay" && path === null) {
			path = arg;
			continue;
		}
		return err({ exit: 2, message: `unexpected argument ${arg}` });
	}

	if (command === "live") {
		return ok({ command: "live", serial, adbPath, headless, allowPartial, columns, rows, maxEvents, filter });
	}
	if (command === "replay") {
		if (!path) return err({ exit: 2, message: "replay requires a recording path" });
		return ok({
			command: "replay",
			path,
			speed,
			headless,
			allowPartial,
			columns,
			rows,
			maxEvents,
			filter,
		});
	}
	if (command === "record") {
		if (!outPath) return err({ exit: 2, message: "record requires --out PATH" });
		return ok({
			command: "record",
			serial,
			adbPath,
			outPath,
			durationSec,
			maxFileBytes,
		});
	}
	return err({ exit: 2, message: `unknown command ${command}` });
}

function sessionFromFlags(flags: {
	columns: number;
	rows: number;
	maxEvents: number | null;
	filter: FilterSpec;
	sessionId: string;
}): ReturnType<typeof defaultSessionOptions> {
	return defaultSessionOptions({
		sessionId: flags.sessionId,
		columns: flags.columns,
		rows: flags.rows,
		initialFilter: flags.filter,
		...(flags.maxEvents !== null ? { maxEvents: flags.maxEvents } : {}),
	});
}

async function attachOrHeadless(session: Session, headless: boolean): Promise<number> {
	if (headless || !process.stdout.isTTY) {
		return runHeadless(session);
	}
	const started = session.start();
	if (!started.ok) {
		process.stderr.write(`failed to start: ${started.error.kind}\n`);
		return 1;
	}
	const tui = await import("@logview/tui");
	const attached = await tui.attachTui(session);
	if (!attached.ok) {
		process.stderr.write(`${attached.error.message}\n`);
		await session.stop();
		return 1;
	}
	await session.sourceDone.catch(() => undefined);
	await attached.value.close();
	await session.stop();
	return 0;
}

export async function main(argv = process.argv): Promise<number> {
	const parsed = parseArgs(argv);
	if (!parsed.ok) {
		process.stderr.write(`${parsed.error.message}\n`);
		return parsed.error.exit;
	}
	const request = parsed.value;
	if (request.command === "help") {
		process.stdout.write(`${usage()}\n`);
		return 0;
	}
	const scheduler = createScheduler();
	if (request.command === "record") {
		const controller = new AbortController();
		const onSig = (): void => controller.abort();
		process.on("SIGINT", onSig);
		process.on("SIGTERM", onSig);
		try {
			return await runRecord(request, controller.signal);
		} finally {
			process.off("SIGINT", onSig);
			process.off("SIGTERM", onSig);
		}
	}
	if (request.command === "live") {
		const source = createAdbSource(
			{ adbPath: request.adbPath, serial: request.serial },
			{ processes: createProcessRunner(), scheduler },
		);
		const created = createSession(sessionFromFlags({ ...request, sessionId: `live-${Date.now()}` }), {
			source,
			scheduler,
		});
		if (!created.ok) {
			process.stderr.write(`${created.error.message}\n`);
			return 2;
		}
		return attachOrHeadless(created.value, request.headless);
	}
	const replay = createReplaySource(
		{ path: request.path, speed: request.speed, allowPartial: request.allowPartial },
		{ files: createRecordingFiles(), scheduler },
	);
	if (!replay.ok) {
		process.stderr.write(`${replay.error.message}\n`);
		return 2;
	}
	const created = createSession(sessionFromFlags({ ...request, sessionId: `replay-${request.path}` }), {
		source: replay.value,
		scheduler,
	});
	if (!created.ok) {
		process.stderr.write(`${created.error.message}\n`);
		return 2;
	}
	return attachOrHeadless(created.value, request.headless);
}

if (import.meta.main) {
	main().then((code) => {
		process.exitCode = code;
	});
}
