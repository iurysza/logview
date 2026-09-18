import { EMPTY_FILTER, err, ok, type FilterSpec, type Result, type SourceKind } from "@logview/core";
import {
	createAdbSource,
	createJevClassifier,
	createProcessRunner,
	createRecordingFiles,
	createReplaySource,
	createScheduler,
	createSession,
	defaultSessionOptions,
	DEFAULT_MAX_RECORDING_BYTES,
	type LogClassifier,
	type Session,
} from "@logview/engine";
import {
	readConfigFile,
	resolveViewerSettings,
	semanticSessionOptions,
	type CliOverlay,
	type ResolvedSemantic,
} from "./config.ts";
import { runHeadless } from "./headless.ts";
import { runRecord } from "./record.ts";

type CliError = { exit: 1 | 2; message: string };

type ViewerFlags = Readonly<{
	configPath: string | null;
	overlay: CliOverlay;
}>;

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
			viewer: ViewerFlags;
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
			viewer: ViewerFlags;
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
  logview live [--serial DEVICE] [--headless] [--semantic] [--config PATH]
  logview record --out PATH [--serial DEVICE] [--duration SEC]
  logview replay PATH [--speed N|instant] [--headless] [--allow-partial] [--semantic] [--config PATH]

Jev text filter:
  Set TYPESAFE_API_KEY. Enable with --semantic or semantic.enabled in logview.json.
  The / text field is then a natural-language query. Eligible logs are classified
  in batches. Pending rows stay visible until scored. Flags override the config file.
  Do not put API keys in the file.

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
	let configPath: string | null = null;
	let filterText: string | null = null;
	let semanticEnabled: boolean | null = null;
	let semanticThreshold: number | null = null;

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
			filterText = value.value;
			continue;
		}

		if (arg === "--config") {
			const value = takeValue(rest, ++i, "--config");

			if (!value.ok) return value;
			configPath = value.value;
			continue;
		}

		if (arg === "--semantic") {
			semanticEnabled = true;
			continue;
		}

		if (arg === "--no-semantic") {
			semanticEnabled = false;
			continue;
		}

		if (arg === "--semantic-threshold") {
			const value = takeValue(rest, ++i, "--semantic-threshold");

			if (!value.ok) return value;
			const n = Number(value.value);

			if (!Number.isFinite(n) || n < 0 || n > 1) {
				return err({ exit: 2, message: "semantic-threshold must be a number between 0 and 1" });
			}

			semanticThreshold = n;
			continue;
		}

		if (arg.startsWith("-")) return err({ exit: 2, message: `unknown option ${arg}` });

		if (command === "replay" && path === null) {
			path = arg;
			continue;
		}

		return err({ exit: 2, message: `unexpected argument ${arg}` });
	}

	const modelFromEnv = process.env.TYPESAFE_DEFAULT_MODEL?.trim() ?? "";

	const overlay: CliOverlay = {
		enabled: semanticEnabled,
		threshold: semanticThreshold,
		filterText,
		modelFromEnv: modelFromEnv.length === 0 ? null : modelFromEnv,
	};

	const viewer: ViewerFlags = { configPath, overlay };

	if (command === "live") {
		return ok({
			command: "live",
			serial,
			adbPath,
			headless,
			allowPartial,
			columns,
			rows,
			maxEvents,
			viewer,
		});
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
			viewer,
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
	sourceKind: SourceKind;
	label: string;
}): ReturnType<typeof defaultSessionOptions> {
	const options = defaultSessionOptions({
		sessionId: flags.sessionId,
		sourceKind: flags.sourceKind,
		label: flags.label,
		columns: flags.columns,
		rows: flags.rows,
		initialFilter: flags.filter,
	});

	if (flags.maxEvents === null) return options;

	return {
		...options,
		maxEvents: flags.maxEvents,
	};
}

function recordingLabel(path: string): string {
	const parts = path.split(/[/\\]/);
	const last = parts[parts.length - 1];

	return last && last.length > 0 ? last : path;
}

function resolveClassifier(semantic: ResolvedSemantic): Result<LogClassifier | undefined, CliError> {
	if (!semantic.enabled) return ok(undefined);

	const apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? "";

	if (apiKey.length === 0) {
		return err({ exit: 2, message: "semantic filter requires TYPESAFE_API_KEY" });
	}

	const created = createJevClassifier({
		apiKey,
		modelId: semantic.modelId,
		timeoutMs: semantic.timeoutMs,
	});

	if (!created.ok) {
		return err({ exit: 2, message: created.error.message });
	}

	return ok(created.value);
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

	await attached.value.done;
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

	if (request.command === "live" || request.command === "replay") {
		const loaded = await readConfigFile(request.viewer.configPath);

		if (!loaded.ok) {
			process.stderr.write(`${loaded.error.message}\n`);

			return loaded.error.exit;
		}

		const viewer = resolveViewerSettings(loaded.value, request.viewer.overlay);
		const classifier = resolveClassifier(viewer.semantic);

		if (!classifier.ok) {
			process.stderr.write(`${classifier.error.message}\n`);

			return classifier.error.exit;
		}

		if (classifier.value) {
			process.stderr.write("Jev semantic filter enabled. The text field is classified in batches.\n");
		}

		const filter = { ...EMPTY_FILTER, text: viewer.filterText };
		const semantic = semanticSessionOptions(viewer.semantic);

		if (request.command === "live") {
			const source = createAdbSource(
				{ adbPath: request.adbPath, serial: request.serial },
				{ processes: createProcessRunner(), scheduler },
			);

			const created = createSession(
				sessionFromFlags({
					...request,
					filter,
					sessionId: `live-${Date.now()}`,
					sourceKind: "live",
					label: request.serial ?? "adb",
				}),
				{
					source,
					scheduler,
					classifier: classifier.value,
					semantic,
				},
			);

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

		const created = createSession(
			sessionFromFlags({
				...request,
				filter,
				sessionId: `replay-${request.path}`,
				sourceKind: "replay",
				label: recordingLabel(request.path),
			}),
			{
				source: replay.value,
				scheduler,
				classifier: classifier.value,
				semantic,
			},
		);

		if (!created.ok) {
			process.stderr.write(`${created.error.message}\n`);

			return 2;
		}

		return attachOrHeadless(created.value, request.headless);
	}

	return 2;
}

if (import.meta.main) {
	main().then((code) => {
		process.exitCode = code;
	});
}
