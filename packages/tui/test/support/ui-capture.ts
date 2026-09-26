import { TerminalControl, type Session } from "@kitlangton/terminal-control";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotFromTerminalControl, type StyledSnapshot } from "./styled-snapshot.ts";

export const TERMCTRL_VERSION = "0.4.1";

export type TerminalControlTool = Readonly<{
	binary: string;
	version: string;
}>;

export type Viewport = Readonly<{ cols: number; rows: number }>;

export type Capture = Readonly<{
	text: string;
	snapshot: StyledSnapshot;
	paths: Readonly<{
		png: string;
		text: string;
		frame: string;
		snapshot: string;
		metadata: string;
	}>;
}>;

export type CaptureMetadata = Readonly<{
	schemaVersion: 1;
	scenario: string;
	checkpoint: string;
	fixture: string;
	sourceRevision: string;
	viewport: Viewport;
	runtime: Readonly<{ bun: string; terminalControl: string; renderer: string }>;
	capture: Readonly<{ cellWidth: number; cellHeight: number; padding: number; pixelRatio: number }>;
}>;

export async function resolveTerminalControl(cwd: string): Promise<TerminalControlTool> {
	return inspectTerminalControlBinary(pinnedBinaryPath(), cwd);
}

export async function inspectTerminalControlBinary(binary: string, cwd: string): Promise<TerminalControlTool> {
	const output = await run(binary, ["--version"], cwd);

	if (output.code !== 0) {
		throw new Error(`Terminal Control ${TERMCTRL_VERSION} cannot start: ${commandError(output)}`);
	}

	const version = /^termctrl\s+(\S+)/.exec(output.stdout.trim())?.[1];

	if (version !== TERMCTRL_VERSION) {
		throw new Error(
			`Terminal Control at ${binary} reports ${version ?? "an unknown version"}; expected pinned ${TERMCTRL_VERSION}. Run bun install; do not use a different termctrl from PATH.`,
		);
	}

	return { binary, version };
}

export async function withTerminalSession<T>(
	tool: TerminalControlTool,
	options: {
		cwd: string;
		command: readonly [string, ...string[]];
		viewport: Viewport;
		color: "always" | "never";
		env?: Readonly<Record<string, string>>;
	},
	action: (session: Session) => Promise<T>,
): Promise<T> {
	let terminal: TerminalControl | null = null;
	let session: Session | null = null;
	let result: T | undefined;
	let workError: unknown;

	try {
		terminal = await TerminalControl.make({ binaryPath: tool.binary, cwd: options.cwd });
		session = await terminal.launch({
			command: options.command,
			cwd: options.cwd,
			viewport: options.viewport,
			color: options.color,
			env: options.env ?? {},
		});
		result = await action(session);
	} catch (cause) {
		workError = cause;
	}

	const cleanupErrors: unknown[] = [];

	if (session) {
		try {
			await session.stop();
		} catch (cause) {
			cleanupErrors.push(cause);
		}
	}

	if (terminal) {
		try {
			await terminal.close();
		} catch (cause) {
			cleanupErrors.push(cause);
		}
	}

	if (workError && cleanupErrors.length > 0) {
		const workMessage = workError instanceof Error ? workError.message : "UI scenario failed";

		throw new AggregateError(
			[workError, ...cleanupErrors],
			`${workMessage}; terminal cleanup also failed`,
		);
	}

	if (workError) throw workError;

	if (cleanupErrors.length === 1) throw cleanupErrors[0];

	if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "terminal cleanup failed");

	return result!;
}

export async function waitForText(session: Session, text: string, timeoutMs = 5_000): Promise<void> {
	await session.screen.waitForText(text, { timeoutMs });
}

export async function waitForScreen(
	session: Session,
	description: string,
	matches: (screen: Readonly<{ text: string; cols: number; rows: number }>) => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	try {
		await session.screen.waitUntil(
			(screen) => matches({ text: screen.text, cols: screen.frame.cols, rows: screen.frame.rows }),
			{ timeoutMs },
		);
	} catch (cause) {
		throw new Error(`screen did not reach ${description}: ${errorMessage(cause)}`);
	}
}

export async function send(session: Session, inputs: readonly string[]): Promise<void> {
	for (const input of inputs) {
		if (input.startsWith("text:")) {
			await session.keyboard.type(input.slice("text:".length));
			continue;
		}

		await session.keyboard.press(key(input));
	}
}

export async function sendBytes(session: Session, bytes: Uint8Array): Promise<void> {
	await session.keyboard.write(bytes);
}

export async function resize(session: Session, viewport: Viewport): Promise<void> {
	await session.resize(viewport);
}

export async function waitForExit(session: Session, timeoutMs = 5_000): Promise<void> {
	const result = await session.waitForExit({ timeoutMs });

	if (result.reason !== "exited") throw new Error(`logview did not exit within ${timeoutMs}ms after quit`);

	if (!result.exit.success) throw new Error(`logview exited unsuccessfully after quit: ${result.exit.code}`);
}

export async function capture(
	tool: TerminalControlTool,
	session: Session,
	options: {
		cwd: string;
		directory: string;
		checkpoint: string;
		metadata: Omit<CaptureMetadata, "checkpoint" | "runtime" | "capture">;
	},
): Promise<Capture> {
	const checkpoint = options.checkpoint;
	const directory = join(options.directory, checkpoint);
	const stem = join(directory, "screen");
	await mkdir(directory, { recursive: true });

	const frame = await session.screen.capture({
		settleMs: 250,
		deadlineMs: 5_000,
		includeAnsi: true,
	});

	if (frame.reason !== "idle") {
		throw new Error(`screen did not settle for ${checkpoint}: Terminal Control stopped because ${frame.reason}`);
	}

	if (!frame.ansi) throw new Error(`Terminal Control did not return ANSI bytes for ${checkpoint}`);

	const paths = {
		png: `${stem}.png`,
		text: `${stem}.txt`,
		frame: `${stem}.json`,
		snapshot: `${stem}.snapshot.json`,
		metadata: `${stem}.meta.json`,
	};

	const ansiPath = `${stem}.ansi`;
	const snapshot = snapshotFromTerminalControl(JSON.stringify(frame.frame));

	const metadata: CaptureMetadata = {
		...options.metadata,
		checkpoint,
		runtime: {
			bun: Bun.version,
			terminalControl: tool.version,
			renderer: `terminal-control-vt100-${tool.version}`,
		},
		capture: { cellWidth: 9, cellHeight: 18, padding: 18, pixelRatio: 2 },
	};

	if (frame.frame.cols !== metadata.viewport.cols || frame.frame.rows !== metadata.viewport.rows) {
		throw new Error(
			`${checkpoint} captured ${frame.frame.cols}x${frame.frame.rows}, expected ${metadata.viewport.cols}x${metadata.viewport.rows}`,
		);
	}

	await Promise.all([
		writeFile(paths.text, `${frame.text}\n`, "utf8"),
		writeFile(paths.frame, `${JSON.stringify(frame.frame, null, 2)}\n`, "utf8"),
		writeFile(paths.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
		writeFile(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
		writeFile(ansiPath, frame.ansi),
	]);

	try {
		const output = await run(tool.binary, [
			"save",
			"--input",
			ansiPath,
			"--cols",
			String(metadata.viewport.cols),
			"--rows",
			String(metadata.viewport.rows),
			"--hide-cursor",
			"--cell-width",
			"9",
			"--cell-height",
			"18",
			"--padding",
			"18",
			"--pixel-ratio",
			"2",
			"--format",
			"png",
			"--out",
			paths.png,
		], options.cwd);

		if (output.code !== 0) {
			throw new Error(`Terminal Control PNG capture failed: ${commandError(output)}`);
		}
	} finally {
		await rm(ansiPath, { force: true });
	}

	if (!(await Bun.file(paths.png).exists())) {
		throw new Error(`Terminal Control did not write screenshot ${paths.png}`);
	}

	return { text: frame.text, snapshot, paths };
}

export async function removeCaptureDirectory(directory: string): Promise<void> {
	await rm(directory, { recursive: true, force: true });
}

function key(input: string): Parameters<Session["keyboard"]["press"]>[0] {
	switch (input) {
		case "enter":
			return "Enter";
		case "escape":
			return "Escape";
		case "up":
			return "ArrowUp";
		case "down":
			return "ArrowDown";
		case "tab":
			return "Tab";
		case "shift-tab":
			return "Shift+Tab";
		case "backspace":
			return "Backspace";
		case "home":
			return "Home";
		case "end":
			return "End";
		case "page-up":
			return "PageUp";
		case "page-down":
			return "PageDown";
		case "ctrl-c":
			return "Control+C";
		default:
			throw new Error(`unsupported Terminal Control input ${input}`);
	}
}

function pinnedBinaryPath(): string {
	const packageName = nativePackageName(process.platform, process.arch);

	if (!packageName) {
		throw new Error(
			`Terminal Control ${TERMCTRL_VERSION} has no packaged binary for ${process.platform}-${process.arch}; use macOS or GNU/Linux on arm64 or x64.`,
		);
	}

	try {
		// Bun's createRequire from @logview/tui cannot see the native optional
		// package. Resolve it from @kitlangton/terminal-control, which owns it.
		const terminalControlPackage = fileURLToPath(
			import.meta.resolve("@kitlangton/terminal-control/package.json"),
		);

		return createRequire(terminalControlPackage).resolve(`${packageName}/bin/termctrl`);
	} catch {
		throw new Error(
			`Pinned Terminal Control ${TERMCTRL_VERSION} package ${packageName} is missing. Run bun install; do not use a different termctrl from PATH.`,
		);
	}
}

function nativePackageName(platform: string, arch: string): string | null {
	if (platform === "darwin" && arch === "arm64") return "@kitlangton/terminal-control-darwin-arm64";

	if (platform === "darwin" && arch === "x64") return "@kitlangton/terminal-control-darwin-x64";

	if (platform === "linux" && arch === "arm64") return "@kitlangton/terminal-control-linux-arm64-gnu";

	if (platform === "linux" && arch === "x64") return "@kitlangton/terminal-control-linux-x64-gnu";

	return null;
}

async function run(
	binary: string,
	args: readonly string[],
	cwd: string,
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
	try {
		const process = Bun.spawn([binary, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

		const [stdout, stderr, code] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);

		return { code, stdout, stderr };
	} catch (cause) {
		throw new Error(`failed to execute pinned Terminal Control: ${errorMessage(cause)}`);
	}
}

function commandError(output: Readonly<{ code: number; stdout: string; stderr: string }>): string {
	return output.stderr.trim() || output.stdout.trim() || `exit ${output.code}`;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : "unknown error";
}
