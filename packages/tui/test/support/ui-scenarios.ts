import type { Session } from "@kitlangton/terminal-control";
import { join } from "node:path";
import { INSPECT_WIDE_COLUMNS } from "../../src/app.ts";
import { inspectorWidth } from "../../src/inspect.ts";
import { THEME } from "../../src/theme.ts";
import { startFakeJev, type FakeJev } from "../../../../tests/support/fake-jev.ts";
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

const REPLAY_BROWSE = "BROWSE";

const DEFAULT_VIEWPORT: Viewport = { cols: 72, rows: 16 };

export const UI_SCENARIO_NAMES = [
	"replay",
	"inspect",
	"inspect-detail",
	"help",
	"filter",
	"sizes",
	"highlight",
	"query",
	"no-color",
	"quit",
	"wrap",
	"jev",
	"jev-error",
	"autocomplete",
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
	/** Local fake Jev server when the scenario sets `jev`; otherwise null. */
	jev: FakeJev | null;
	capture: (checkpoint: string, viewport: Viewport) => Promise<Capture>;
}>;

type UiScenario = Readonly<{
	name: UiScenarioName;
	viewport: Viewport;
	color: "always" | "never";
	/** Starts a local fake Jev and launches with `--semantic`. */
	jev?: "score" | "auth-error";
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
	const jev = scenario.jev === undefined ? null : startFakeJev(scenario.jev);

	try {
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
				...(jev ? ["--semantic"] : ["--no-semantic"]),
			],
			viewport: scenario.viewport,
			color: scenario.color,
			env: jev?.env ?? {},
		},
		async (session) => {
			await waitForText(session, REPLAY_DONE);
			await scenario.run({
				tool,
				cwd: options.cwd,
				session,
				jev,
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
	} finally {
		await jev?.stop();
	}

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
				(screen) => screen.text.split("\n")[3]?.startsWith("▸") === true,
			);
			const pageUp = await context.capture("ctrl-u", { cols: 120, rows: 24 });
			expectCell(pageUp, 0, 3, "▸", "Ctrl+U page up");
			await sendBytes(context.session, new TextEncoder().encode("\u0004"));
			await waitForScreen(
				context.session,
				"Ctrl+D selects the newest event",
				(screen) => screen.text.split("\n")[20]?.startsWith("▸") === true,
			);
			const pageDown = await context.capture("ctrl-d", { cols: 120, rows: 24 });
			expectCell(pageDown, 0, 20, "▸", "Ctrl+D page down");
			await send(context.session, ["text:G"]);
			await waitForScreen(
				context.session,
				"G returns to tail mode",
				(screen) => screen.text.split("\n").at(-1)?.trimStart().startsWith("TAIL") === true,
			);
			const final = await context.capture("final", { cols: 120, rows: 24 });
			expectText(final, "日本語 ok", "replay final");
		},
	},
	{
		name: "wrap",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		async run(context) {
			const clipped = await context.capture("clipped", { cols: 120, rows: 24 });
			expectText(clipped, "…", "clipped log row");
			await send(context.session, ["text:w"]);
			await waitForText(context.session, "│");
			await context.capture("wrapped", { cols: 120, rows: 24 });
		},
	},
	{
		name: "inspect",
		viewport: { cols: INSPECT_WIDE_COLUMNS, rows: 24 },
		color: "always",
		async run(context) {
			await send(context.session, ["enter"]);
			await waitForText(context.session, "filter by this tag");
			const wide = await context.capture("wide-120", { cols: INSPECT_WIDE_COLUMNS, rows: 24 });
			expectCell(wide, 71, 2, "│", "wide inspector divider");
			expectText(wide, "Event Details", "wide inspector heading");
			expectText(wide, "Message", "wide inspector message section");
			expectText(wide, "Raw", "wide inspector raw section");

			await resize(context.session, { cols: INSPECT_WIDE_COLUMNS - 1, rows: 24 });
			await waitForScreen(
				context.session,
				"119-column inspector overlay",
				(screen) => screen.cols === 119 && screen.text.split("\n")[2]?.startsWith("Event Details") === true,
			);
			const breakpoint = await context.capture("narrow-119", { cols: INSPECT_WIDE_COLUMNS - 1, rows: 24 });
			expectNoCellText(breakpoint, 71, 2, "│", "breakpoint overlay");

			const narrow = { cols: 72, rows: 17 };

			await resize(context.session, narrow);
			await waitForScreen(
				context.session,
				"72-column inspector overlay",
				(screen) => screen.cols === 72 && screen.rows === 17 && screen.text.split("\n")[2]?.startsWith("Event Details") === true,
			);
			const final = await context.capture("final", narrow);
			expectText(final, "日本語 ok", "narrow inspector");
		},
	},
	{
		name: "inspect-detail",
		viewport: { cols: INSPECT_WIDE_COLUMNS, rows: 30 },
		color: "always",
		async run(context) {
			const viewport = { cols: INSPECT_WIDE_COLUMNS, rows: 30 };

			await selectHeader(context.session, "Start proc");
			await send(context.session, ["enter"]);
			await waitForText(context.session, "MainActivity}");
			const longMessage = await context.capture("long-message", viewport);
			expectText(longMessage, "MainActivity}", "long message end");
			expectNoInspectorEllipsis(longMessage, INSPECT_WIDE_COLUMNS, "long message");

			await send(context.session, ["escape"]);
			await waitForScreen(context.session, "list after long message", (screen) => {
				return screen.text.split("\n").at(-1)?.trimStart().startsWith("BROWSE") === true;
			});

			await selectHeader(context.session, "Retry after lock timeout", "down");
			await send(context.session, ["enter"]);
			await waitForScreen(context.session, "stack inspector", (screen) => {
				const footer = screen.text.split("\n").at(-1) ?? "";

				return footer.trimStart().startsWith("INSPECT") && screen.text.includes("(Store.java:88)");
			});
			const stackTrace = await context.capture("stack-trace", viewport);
			expectText(stackTrace, "(Store.java:88)", "stack location");
			expectText(stackTrace, "(Store.java:41)", "second stack frame");
			expectNoInspectorEllipsis(stackTrace, INSPECT_WIDE_COLUMNS, "stack trace");
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
			expectText(final, "h            fill empty list space", "help overlay");
		},
	},
	{
		name: "filter",
		viewport: DEFAULT_VIEWPORT,
		color: "always",
		async run(context) {
			await send(context.session, ["text:/"]);
			await waitForText(context.session, "QUERY");
			await send(context.session, ["text:Database"]);
			await waitForText(context.session, "/  Database");
			await send(context.session, ["enter"]);
			await waitForText(context.session, "Text / Database");
			const applied = await context.capture("applied", DEFAULT_VIEWPORT);
			expectText(applied, "Text / Database", "applied text filter");

			await send(context.session, ["text:/", ...Array.from({ length: 8 }, () => "backspace"), "text:no-match"]);
			await waitForText(context.session, "/  no-match");
			await send(context.session, ["enter"]);
			await waitForText(context.session, "No events match no-match");
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

			if (!header.includes("logcayo") || !header.includes("15 events")) {
				throw new Error(`48-column ANSI header is not fitted: ${JSON.stringify(header)}`);
			}

			await resize(context.session, { cols: 39, rows: 7 });
			await waitForText(context.session, "Terminal too small");
			await context.capture("final", { cols: 39, rows: 7 });
		},
	},
	{
		name: "query",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		async run(context) {
			await send(context.session, ["text:/"]);
			await waitForText(context.session, "QUERY");
			await send(context.session, ["text:level:W tag:Database lock"]);
			await send(context.session, ["enter"]);
			await waitForText(context.session, "1 of 15");
			await context.capture("final", { cols: 120, rows: 24 });
		},
	},
	{
		name: "highlight",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		async run(context) {
			const final = await context.capture("final", { cols: 120, rows: 24 });

			const errorCell = cellsFromSnapshot(final.snapshot).find(
				(cell) => cell.text === "E" && cell.x >= 16 && cell.x < 19 && cell.y >= 3,
			);

			if (!errorCell || !samePaletteColor(errorCell.foreground, THEME.red)) {
				throw new Error("highlighted error severity is missing its reference red foreground");
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
		name: "jev",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		jev: "score",
		async run(context) {
			await send(context.session, ["text:/"]);
			await waitForText(context.session, "~question asks Jev");
			await context.capture("empty-query", { cols: 120, rows: 24 });

			await send(context.session, ["text:~database locks"]);
			await waitForText(context.session, "Enter asks Jev");
			await context.capture("draft", { cols: 120, rows: 24 });

			context.jev?.hold();
			await send(context.session, ["enter"]);
			await waitForText(context.session, "asking");
			await context.capture("asking", { cols: 120, rows: 24 });

			context.jev?.release();
			await waitForText(context.session, "relevant");
			const scored = await context.capture("scored", { cols: 120, rows: 24 });

			expectText(scored, "✦ Jev database locks", "scored");
			expectText(scored, "━━━━━ 0.93", "scored");

			await send(context.session, ["text:v"]);
			await waitForText(context.session, "hidden");
			const hidden = await context.capture("hidden", { cols: 120, rows: 24 });

			expectText(hidden, "Show all", "hidden");
			await send(context.session, ["text:v"]);
			await waitForText(context.session, "Hide weak");

			await send(context.session, ["text:m"]);
			await waitForText(context.session, "Text / database locks");
			await context.capture("literal", { cols: 120, rows: 24 });
		},
	},
	{
		name: "jev-error",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		jev: "auth-error",
		async run(context) {
			await send(context.session, ["text:/"]);
			await send(context.session, ["text:~database locks"]);
			await send(context.session, ["enter"]);
			await waitForText(context.session, "API key rejected");
			await context.capture("final", { cols: 120, rows: 24 });
		},
	},
	{
		name: "autocomplete",
		viewport: { cols: 120, rows: 24 },
		color: "always",
		async run(context) {
			await send(context.session, ["text:/"]);
			await send(context.session, ["text:ta"]);
			await waitForText(context.session, "tag:");
			await context.capture("key", { cols: 120, rows: 24 });

			await send(context.session, ["tab"]);
			await waitForText(context.session, "tag:logview-demo");
			await context.capture("values", { cols: 120, rows: 24 });

			await send(context.session, ["text:Da", "tab"]);
			await waitForText(context.session, "4 of 15");
			const accepted = await context.capture("accepted", { cols: 120, rows: 24 });

			expectText(accepted, "tag:Database", "accepted");
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

function inspectorBody(capture: Capture, columns: number): string {
	const width = columns >= INSPECT_WIDE_COLUMNS ? inspectorWidth(columns) : columns;
	const start = columns - width;
	const lines = capture.text.split("\n").slice(3, -3);

	return lines.map((line) => line.slice(start, start + width)).join("\n");
}

function expectNoInspectorEllipsis(capture: Capture, columns: number, checkpoint: string): void {
	if (inspectorBody(capture, columns).includes("…")) {
		throw new Error(`${checkpoint} inspector still clips with an ellipsis; inspect ${capture.paths.text}`);
	}
}

async function selectHeader(session: Session, label: string, direction: "up" | "down" = "up"): Promise<void> {
	for (let step = 0; step < 20; step += 1) {
		let selected = "";

		await waitForScreen(session, `${label} selection`, (screen) => {
			selected = screen.text.split("\n").find((line) => line.startsWith("▸")) ?? "";

			return selected.length > 0;
		});

		if (selected.includes(label)) return;

		const before = selected;

		await send(session, [direction]);
		await waitForScreen(session, `move toward ${label}`, (screen) => {
			const line = screen.text.split("\n").find((row) => row.startsWith("▸")) ?? "";

			return line.length > 0 && line !== before;
		});
	}

	throw new Error(`did not select ${label}`);
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
