import type { Session } from "@kitlangton/terminal-control";
import { displayWidth } from "@logview/core";
import { join } from "node:path";
import { INSPECT_WIDE_COLUMNS } from "../../src/app.ts";
import { MOCHA } from "../../src/catppuccin.ts";
import { cellsFromSnapshot } from "./styled-snapshot.ts";
import {
	capture,
	resize,
	resolveTerminalControl,
	send,
	sendBytes,
	waitForExit,
	waitForScreen,
	waitForText,
	withTerminalSession,
	type Capture,
	type TerminalControlTool,
	type Viewport,
} from "./ui-capture.ts";

const REPLAY_FIXTURE = "tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl";

const REPLAY_DONE = "REPLAY • END";

const REPLAY_BROWSE = "REPLAY • BROWSE";

const DEFAULT_VIEWPORT: Viewport = { cols: 72, rows: 16 };

export const UI_SCENARIO_NAMES = [
	"replay",
	"inspect",
	"help",
	"filter",
	"sizes",
	"highlight",
	"no-color",
	"quit",
] as const;

export type UiScenarioName = (typeof UI_SCENARIO_NAMES)[number];

export type ScenarioCapture = Readonly<{
	checkpoint: string;
	capture: Capture;
}>;

export type ScenarioRun = Readonly<{
	scenario: UiScenarioName;
	captures: readonly ScenarioCapture[];
}>;

type ScenarioContext = Readonly<{
	tool: TerminalControlTool;
	cwd: string;
	session: Session;
	capture: (checkpoint: string, viewport: Viewport) => Promise<Capture>;
}>;

type UiScenario = Readonly<{
	name: UiScenarioName;
	viewport: Viewport;
	color: "always" | "never";
	run: (context: ScenarioContext) => Promise<void>;
}>;

export async function runUiScenario(options: {
	cwd: string;
	scenario: UiScenarioName;
	outDirectory: string;
}): Promise<ScenarioRun> {
	const scenario = findScenario(options.scenario);
	const tool = await resolveTerminalControl(options.cwd);
	const sourceRevision = await gitRevision(options.cwd);
	const captures: ScenarioCapture[] = [];

	await withTerminalSession(
		tool,
		{
			cwd: options.cwd,
			command: [
				process.execPath,
				join(options.cwd, "packages/cli/src/main.ts"),
				"replay",
				REPLAY_FIXTURE,
				"--speed",
				"instant",
			],
			viewport: scenario.viewport,
			color: scenario.color,
		},
		async (session) => {
			await waitForText(session, REPLAY_DONE);
			await scenario.run({
				tool,
				cwd: options.cwd,
				session,
				capture: async (checkpoint, viewport) => {
					const saved = await capture(tool, session, {
						cwd: options.cwd,
						directory: options.outDirectory,
						checkpoint,
						metadata: {
							schemaVersion: 1,
							scenario: scenario.name,
							fixture: REPLAY_FIXTURE,
							sourceRevision,
							viewport,
						},
					});

					captures.push({ checkpoint, capture: saved });

					return saved;
				},
			});
		},
	);

	return { scenario: scenario.name, captures };
}

export function isUiScenarioName(value: string): value is UiScenarioName {
	return UI_SCENARIO_NAMES.some((name) => name === value);
}

const SCENARIOS: readonly UiScenario[] = [
	{
		name: "replay",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		async run(context) {
			await sendBytes(context.session, new TextEncoder().encode("\u001b["));
			await sendBytes(context.session, new TextEncoder().encode("A"));
			await waitForText(context.session, REPLAY_BROWSE);
			await context.capture("browse", { cols: 120, rows: 24 });
			await sendBytes(context.session, new TextEncoder().encode("\u0015"));
			await waitForScreen(
				context.session,
				"Ctrl+U selects the oldest event",
				(screen) => screen.text.split("\n")[2]?.startsWith("▸") === true,
			);
			const pageUp = await context.capture("ctrl-u", { cols: 120, rows: 24 });
			expectCell(pageUp, 0, 2, "▸", "Ctrl+U page up");
			await sendBytes(context.session, new TextEncoder().encode("\u0004"));
			await waitForScreen(
				context.session,
				"Ctrl+D selects the newest event",
				(screen) => screen.text.split("\n")[19]?.startsWith("▸") === true,
			);
			const pageDown = await context.capture("ctrl-d", { cols: 120, rows: 24 });
			expectCell(pageDown, 0, 19, "▸", "Ctrl+D page down");
			await send(context.session, ["text:G"]);
			await waitForText(context.session, REPLAY_DONE);
			const final = await context.capture("final", { cols: 120, rows: 24 });
			expectText(final, "日本語 ok", "replay final");
		},
	},
	{
		name: "inspect",
		viewport: { cols: INSPECT_WIDE_COLUMNS, rows: 24 },
		color: "always",
		async run(context) {
			await send(context.session, ["enter"]);
			await waitForText(context.session, "t filter tag");
			const wide = await context.capture("wide-120", { cols: INSPECT_WIDE_COLUMNS, rows: 24 });
			expectCell(wide, 76, 2, "│", "wide inspector divider");

			await resize(context.session, { cols: INSPECT_WIDE_COLUMNS - 1, rows: 24 });
			await waitForScreen(
				context.session,
				"119-column inspector overlay",
				(screen) => screen.cols === 119 && screen.text.split("\n")[2]?.startsWith("Event") === true,
			);
			const breakpoint = await context.capture("narrow-119", { cols: INSPECT_WIDE_COLUMNS - 1, rows: 24 });
			expectNoCellText(breakpoint, 76, 2, "│", "breakpoint overlay");

			await resize(context.session, DEFAULT_VIEWPORT);
			await waitForScreen(
				context.session,
				"72-column inspector overlay",
				(screen) => screen.cols === 72 && screen.text.split("\n")[2]?.startsWith("Event") === true,
			);
			const final = await context.capture("final", DEFAULT_VIEWPORT);
			expectText(final, "日本語 ok", "narrow inspector");
		},
	},
	{
		name: "help",
		viewport: DEFAULT_VIEWPORT,
		color: "always",
		async run(context) {
			await send(context.session, ["text:?"]);
			await waitForText(context.session, "Keys");
			const final = await context.capture("final", DEFAULT_VIEWPORT);
			expectText(final, "t / p        from inspect", "help overlay");
		},
	},
	{
		name: "filter",
		viewport: DEFAULT_VIEWPORT,
		color: "always",
		async run(context) {
			await send(context.session, ["text:/"]);
			await waitForText(context.session, "Edit text:");
			await send(context.session, ["text:Database"]);
			await waitForText(context.session, "Edit text: Database");
			await send(context.session, ["enter"]);
			await waitForText(context.session, "/ Database");
			const applied = await context.capture("applied", DEFAULT_VIEWPORT);
			expectText(applied, "4/15 shown", "applied text filter");

			await send(context.session, ["text:/", ...Array.from({ length: 8 }, () => "backspace"), "text:no-match"]);
			await waitForText(context.session, "Edit text: no-match");
			await send(context.session, ["enter"]);
			await waitForText(context.session, "0/15 shown");
			await context.capture("final", DEFAULT_VIEWPORT);
		},
	},
	{
		name: "sizes",
		viewport: { cols: 48, rows: 12 },
		color: "always",
		async run(context) {
			const narrow = await context.capture("columns-48", { cols: 48, rows: 12 });
			const header = firstLine(narrow);

			if (!header.includes("logview") || !header.endsWith("15 events") || displayWidth(header) !== 48) {
				throw new Error(`48-column ANSI header is not fitted: ${JSON.stringify(header)}`);
			}

			await resize(context.session, { cols: 39, rows: 7 });
			await waitForText(context.session, "Terminal too small");
			await context.capture("final", { cols: 39, rows: 7 });
		},
	},
	{
		name: "highlight",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		async run(context) {
			const final = await context.capture("final", { cols: 120, rows: 24 });
			const errorCell = cellsFromSnapshot(final.snapshot).find((cell) => cell.text === "E");

			if (!errorCell || !samePaletteColor(errorCell.foreground, MOCHA.red)) {
				throw new Error("highlighted error severity is missing its Catppuccin red foreground");
			}

			expectText(final, "token=REDACTED", "highlighted replay");
		},
	},
	{
		name: "no-color",
		viewport: DEFAULT_VIEWPORT,
		color: "never",
		async run(context) {
			const final = await context.capture("final", DEFAULT_VIEWPORT);

			const colored = final.snapshot.spans.some(
				(span) =>
					!sameTerminalColor(span.foreground, final.snapshot.foreground) ||
					!sameTerminalColor(span.background, final.snapshot.background),
			);

			if (colored) throw new Error("NO_COLOR replay contains styled cells");
		},
	},
	{
		name: "quit",
		viewport: DEFAULT_VIEWPORT,
		color: "always",
		async run(context) {
			await context.capture("final", DEFAULT_VIEWPORT);
			await send(context.session, ["text:q"]);
			await waitForExit(context.session);
			const transcript = new TextDecoder().decode(await context.session.transcript.ansi());

			for (const sequence of ["\u001b[?25h", "\u001b[?7h", "\u001b[?1049l"]) {
				if (!transcript.includes(sequence)) {
					throw new Error(`quit did not restore terminal sequence ${JSON.stringify(sequence)}`);
				}
			}
		},
	},
];

function findScenario(name: UiScenarioName): UiScenario {
	const scenario = SCENARIOS.find((candidate) => candidate.name === name);

	if (!scenario) throw new Error(`unknown UI scenario ${name}`);

	return scenario;
}

function expectText(capture: Capture, text: string, checkpoint: string): void {
	if (!capture.text.includes(text)) {
		throw new Error(`${checkpoint} does not show ${JSON.stringify(text)}; inspect ${capture.paths.text}`);
	}
}

function expectCell(capture: Capture, x: number, y: number, text: string, checkpoint: string): void {
	const found = cellsFromSnapshot(capture.snapshot).some(
		(cell) => cell.x === x && cell.y === y && cell.text === text,
	);

	if (!found) throw new Error(`${checkpoint} does not contain ${JSON.stringify(text)} at ${x},${y}`);
}

function expectNoCellText(capture: Capture, x: number, y: number, text: string, checkpoint: string): void {
	const found = cellsFromSnapshot(capture.snapshot).some(
		(cell) => cell.x === x && cell.y === y && cell.text === text,
	);

	if (found) throw new Error(`${checkpoint} still contains ${JSON.stringify(text)} at ${x},${y}`);
}

function firstLine(capture: Capture): string {
	return capture.text.split("\n")[0] ?? "";
}

function samePaletteColor(
	color: Readonly<{ r: number; g: number; b: number }>,
	expected: readonly [number, number, number],
): boolean {
	return color.r === expected[0] && color.g === expected[1] && color.b === expected[2];
}

function sameTerminalColor(
	left: Readonly<{ r: number; g: number; b: number }>,
	right: Readonly<{ r: number; g: number; b: number }>,
): boolean {
	return left.r === right.r && left.g === right.g && left.b === right.b;
}

async function gitRevision(cwd: string): Promise<string> {
	const process = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);

	if (code !== 0) throw new Error(`could not read source revision: ${stderr.trim() || `exit ${code}`}`);

	return stdout.trim();
}
