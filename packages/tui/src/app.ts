import {
	EMPTY_SELECTION,
	LIST_FOCUS,
	displayWidth,
	formatTimestamp,
	messageText,
	padToWidth,
	reduceInteraction,
	sanitizeDisplay,
	tagText,
	type InteractionSelection,
	type InteractionState,
	type LogEvent,
	err,
	ok,
	type Result,
} from "@logview/core";
import type { Session, SessionSnapshot, TerminalAttachment, UiError } from "@logview/engine";
import { MOCHA, type Rgb } from "./catppuccin.ts";
import { paintChrome, paintFilled, paintRow, paintStyleFromEnv, type PaintStyle } from "./color.ts";

export const ROW_POOL_OVERSCAN = 2;

export const INSPECT_WIDE_COLUMNS = 120;

function modeLabel(snapshot: SessionSnapshot): string {
	if (snapshot.source.kind === "failed") {
		return snapshot.sourceKind === "replay" ? "REPLAY • FAILED" : "LIVE • FAILED";
	}

	if (snapshot.sourceKind === "replay") {
		if (snapshot.view.mode === "browse") return "REPLAY • BROWSE";

		if (snapshot.source.kind === "ended") return "REPLAY • END";

		if (snapshot.source.kind === "running" || snapshot.source.kind === "starting") return "REPLAY • PLAYING";

		return "REPLAY • IDLE";
	}

	if (snapshot.view.mode === "browse") return `BROWSE • +${snapshot.view.newSincePause} NEW`;

	if (snapshot.source.kind === "running" || snapshot.source.kind === "starting") return "LIVE • FOLLOWING";

	if (snapshot.source.kind === "ended") return "LIVE • END";

	return "LIVE • IDLE";
}

function modeColor(snapshot: SessionSnapshot): Rgb {
	if (snapshot.source.kind === "failed") return MOCHA.red;

	if (snapshot.view.mode === "browse") return MOCHA.yellow;

	if (snapshot.source.kind === "running" || snapshot.source.kind === "starting") return MOCHA.green;

	return MOCHA.overlay1;
}

export function formatStatus(snapshot: SessionSnapshot): string {
	return `logview   ${modeLabel(snapshot)}   ${snapshot.label}`;
}

export function formatFilter(snapshot: SessionSnapshot): string {
	const filter = snapshot.activeFilter;
	const level = filter.minLevel ? `${filter.minLevel}+` : "ALL";
	const tag = filter.tag ? `tag:${filter.tag}` : "tag:*";
	const pid = filter.pid === null ? "pid:*" : `pid:${filter.pid}`;
	const semantic = snapshot.semantic !== null && filter.text.length > 0;
	const text = filter.text ? `${semantic ? "~" : "/"} ${filter.text}` : "/";

	return `${level}   ${tag}   ${pid}   ${text}`;
}

export function formatHints(): string {
	return "↑↓  Enter  /  f  G  ?  q quit";
}

export function formatFooter(snapshot: SessionSnapshot): string {
	let extra = "";

	if (snapshot.notice === "history-expired") extra = " · earlier history expired";
	else if (snapshot.notice === "applying-filter") extra = " · applying filters";
	else if (snapshot.notice === "resize-required") extra = " · resize terminal";
	else if (snapshot.stats.lagging) extra = " · catching up";

	const shown = snapshot.stats.matchedEvents;
	const buffered = snapshot.stats.retainedEvents;

	const semantic =
		snapshot.semantic && snapshot.semantic.queryText.length > 0
			? ` · ${snapshot.semantic.classifiedEvents} classified · ${snapshot.semantic.pendingEvents} pending`
			: "";

	const unseen =
		snapshot.view.mode === "browse" && snapshot.view.newSincePause > 0
			? ` · ${snapshot.view.newSincePause} unseen`
			: "";

	const mode = modeLabel(snapshot).split(" • ")[0] ?? "LIVE";

	return `${mode}   ${shown}/${buffered} shown${unseen}${semantic}${extra}    ${formatHints()}`;
}

function splitEnds(left: string, right: string, columns: number): string {
	const rightWidth = displayWidth(right);
	const leftBudget = Math.max(0, columns - rightWidth - 1);
	const leftFitted = padToWidth(left, leftBudget);
	const gap = Math.max(1, columns - displayWidth(leftFitted) - rightWidth);

	return `${leftFitted}${" ".repeat(gap)}${right}`;
}

function paintStatus(snapshot: SessionSnapshot, columns: number, style: PaintStyle): string {
	const right = `${snapshot.stats.retainedEvents} events`;
	const plain = splitEnds(formatStatus(snapshot), right, columns);

	if (style === "plain") return plain;

	const mode = modeLabel(snapshot);
	const title = paintChrome("logview", MOCHA.subtext1, style);
	const sep = paintChrome("   ", MOCHA.overlay0, style);
	const modePainted = paintChrome(mode, modeColor(snapshot), style);
	const label = paintChrome(snapshot.label, MOCHA.overlay1, style);
	const count = paintChrome(right, MOCHA.overlay1, style);
	const left = `${title}${sep}${modePainted}${sep}${label}`;
	const leftPlain = `logview   ${mode}   ${snapshot.label}`;
	const gap = Math.max(1, columns - displayWidth(leftPlain) - displayWidth(right));

	return `${left}${" ".repeat(gap)}${count}`;
}

function paintFilterLine(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	columns: number,
	style: PaintStyle,
): string {
	if (interaction.focus === "filters") {
		const error = interaction.error ? `  ! ${interaction.error.message}` : "";
		const editor = `Edit ${interaction.field}: ${interaction.draft[interaction.field]}${error}`;
		const color = interaction.error ? MOCHA.red : MOCHA.peach;

		return paintFilled(editor, columns, style, color, style === "ansi" ? MOCHA.surface0 : null);
	}

	if (style === "plain") return padToWidth(formatFilter(snapshot), columns);

	const filter = snapshot.activeFilter;
	const levelText = filter.minLevel ? `${filter.minLevel}+` : "ALL";
	const tagTextValue = filter.tag ? `tag:${filter.tag}` : "tag:*";
	const pidText = filter.pid === null ? "pid:*" : `pid:${filter.pid}`;
	const searchText = filter.text ? `${snapshot.semantic && filter.text ? "~" : "/"} ${filter.text}` : "/";
	const level = paintChrome(levelText, filter.minLevel ? MOCHA.yellow : MOCHA.overlay2, style);
	const tag = paintChrome(tagTextValue, filter.tag ? MOCHA.green : MOCHA.overlay2, style);
	const pid = paintChrome(pidText, filter.pid === null ? MOCHA.overlay2 : MOCHA.teal, style);
	const text = paintChrome(searchText, filter.text ? MOCHA.peach : MOCHA.overlay2, style);
	const painted = `${level}   ${tag}   ${pid}   ${text}`;

	return `${painted}${" ".repeat(Math.max(0, columns - displayWidth(formatFilter(snapshot))))}`;
}

function paintFooter(snapshot: SessionSnapshot, columns: number, style: PaintStyle): string {
	const plain = padToWidth(formatFooter(snapshot), columns);

	if (style === "plain") return plain;

	return paintFilled(formatFooter(snapshot), columns, style, MOCHA.subtext0, MOCHA.surface0);
}

function inspectWidth(columns: number): number {
	return Math.min(48, Math.max(32, Math.floor(columns * 0.36)));
}

function selectedHeaderRow(snapshot: SessionSnapshot): SessionSnapshot["rows"][number] | undefined {
	for (const row of snapshot.rows) {
		if (row.id === snapshot.view.selectedId && row.kind === "header") return row;
	}

	return undefined;
}

function classificationLabel(row: SessionSnapshot["rows"][number] | undefined): string | null {
	if (!row || row.classification.kind === "none") return null;

	if (row.classification.kind === "scored") {
		return `Jev ${row.classification.relevance.toFixed(2)}`;
	}

	if (row.classification.kind === "pending") return "Jev pending";

	return `Jev ${row.classification.reason}`;
}

function inspectLines(
	event: LogEvent | null,
	width: number,
	height: number,
	classification: string | null = null,
): string[] {
	const actions = ["t filter tag", "p filter pid", "Esc close"];
	const content: string[] = [];

	if (!event) {
		content.push("No event selected");
	} else {
		content.push("Event", "");

		if (event.metadata) {
			content.push(formatTimestamp(event.metadata.epochMicros));
			content.push(event.metadata.level);
			content.push(`PID ${event.metadata.pid}  TID ${event.metadata.tid}`);
			content.push(`tag ${tagText(event.rawText, event.metadata.tag)}`);
			content.push("");
			content.push(sanitizeDisplay(messageText(event.rawText, event.metadata.message)));
		} else {
			content.push(sanitizeDisplay(event.rawText));
		}

		if (classification) {
			content.push("");
			content.push(classification);
		}

		if (event.continuations.length > 0) {
			content.push("");

			for (const line of event.continuations) content.push(sanitizeDisplay(line));
		}

		content.push("");
		content.push("Raw");
		content.push(sanitizeDisplay(event.rawText));

		for (const line of event.continuations) content.push(sanitizeDisplay(line));
	}

	const fitted: string[] = [];
	const rows = Math.max(1, height);
	const actionRows = Math.min(actions.length, rows);
	const contentRows = Math.max(0, rows - actionRows);

	for (let i = 0; i < contentRows; i += 1) fitted.push(padToWidth(content[i] ?? "", width));

	for (let i = actions.length - actionRows; i < actions.length; i += 1) {
		fitted.push(padToWidth(actions[i]!, width));
	}

	return fitted;
}

function helpLines(width: number): string[] {
	const lines = [
		"Keys",
		"",
		"↑↓ / j k     move between events",
		"PgUp PgDn    page",
		"G / End      jump to end",
		"Home         oldest",
		"Enter        inspect event",
		"/            text filter (Jev when enabled)",
		"f            filter editor",
		"t / p        from inspect: filter tag or pid",
		"?            this help",
		"q            quit",
	];

	const fitted: string[] = [];

	for (const line of lines) fitted.push(padToWidth(line, width));

	return fitted;
}

function paintLogRows(
	rows: SessionSnapshot["rows"],
	columns: number,
	count: number,
	style: PaintStyle,
): string[] {
	const lines: string[] = [];

	for (const row of rows) {
		if (lines.length >= count) break;

		lines.push(paintRow(row, style, columns));
	}

	while (lines.length < count) lines.push(padToWidth("", columns));

	return lines;
}

function fillPane(pane: string[], count: number, columns: number, style: PaintStyle): string[] {
	const lines: string[] = [];

	for (let i = 0; i < count; i += 1) {
		const text = pane[i] ?? "";
		lines.push(paintFilled(text.trimEnd(), columns, style, MOCHA.text, style === "ansi" ? MOCHA.surface0 : null));
	}

	return lines;
}

function splitPane(
	logLines: string[],
	pane: string[],
	columns: number,
	style: PaintStyle,
): string[] {
	const width = inspectWidth(columns);
	const leftWidth = Math.max(1, columns - width - 1);
	const out: string[] = [];

	for (let i = 0; i < logLines.length; i += 1) {
		const left = logLines[i] ?? padToWidth("", leftWidth);
		const right = pane[i] ?? padToWidth("", width);
		const divider = style === "plain" ? "│" : paintChrome("│", MOCHA.overlay0, style);

		const rightPainted =
			style === "plain" ? right : paintFilled(right.trimEnd(), width, style, MOCHA.text, MOCHA.surface0);

		out.push(`${left}${divider}${rightPainted}`);
	}

	return out;
}

export function renderRowText(row: SessionSnapshot["rows"][number], style: PaintStyle = "plain", columns?: number): string {
	return paintRow(row, style, columns);
}

function layoutLines(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	style: PaintStyle,
	columns: number,
	rows: number,
): readonly string[] {
	if (rows <= 0 || columns <= 0) return [];

	if (snapshot.notice === "resize-required") {
		const lines = [padToWidth("Terminal too small. Resize to at least 40x8. Ingestion continues.", columns)];

		while (lines.length < rows) lines.push(padToWidth("", columns));

		return lines.slice(0, rows);
	}

	const header = [
		paintStatus(snapshot, columns, style),
		paintFilterLine(snapshot, interaction, columns, style),
	];

	const footer = paintFooter(snapshot, columns, style);
	const viewport = Math.max(0, rows - 3);
	const inspectOpen = interaction.focus === "inspect";
	const helpOpen = interaction.focus === "help";
	const wideInspect = inspectOpen && columns >= INSPECT_WIDE_COLUMNS;
	const logWidth = wideInspect ? Math.max(1, columns - inspectWidth(columns) - 1) : columns;
	let body = paintLogRows(snapshot.rows, logWidth, viewport, style);
	const selectedRow = selectedHeaderRow(snapshot);
	const classification = classificationLabel(selectedRow);

	if (helpOpen) {
		body = fillPane(helpLines(columns), viewport, columns, style);
	} else if (inspectOpen && !wideInspect) {
		body = fillPane(
			inspectLines(snapshot.selectedEvent, columns, viewport, classification),
			viewport,
			columns,
			style,
		);
	} else if (wideInspect) {
		body = splitPane(
			body,
			inspectLines(snapshot.selectedEvent, inspectWidth(columns), viewport, classification),
			columns,
			style,
		);
	}

	const lines = [...header, ...body, footer];

	while (lines.length < rows) lines.push(padToWidth("", columns));

	return lines.slice(0, rows);
}

export function layoutSession(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	style: PaintStyle = "plain",
	columns = 80,
	rows = 24,
): readonly string[] {
	return layoutLines(snapshot, interaction, style, columns, rows);
}

export function layoutFrame(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	columns: number,
	rows: number,
	style: PaintStyle = "plain",
): readonly string[] {
	return layoutLines(snapshot, interaction, style, columns, rows);
}

type KeyCommand = Readonly<{
	key: string;
	ctrl: boolean;
	shift: boolean;
}>;

function decodeChunk(chunk: Uint8Array | string): string {
	if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);

	return chunk;
}

function keyFromText(text: string): KeyCommand | null {
	if (text === "\u0003") return { key: "c", ctrl: true, shift: false };

	if (text === "\u001b") return { key: "escape", ctrl: false, shift: false };

	if (text === "\r" || text === "\n") return { key: "enter", ctrl: false, shift: false };

	if (text === "\t") return { key: "tab", ctrl: false, shift: false };

	if (text === "\u001b[Z") return { key: "tab", ctrl: false, shift: true };

	if (text === "\u007f" || text === "\b") return { key: "backspace", ctrl: false, shift: false };

	if (text === "\u001b[A") return { key: "up", ctrl: false, shift: false };

	if (text === "\u001b[B") return { key: "down", ctrl: false, shift: false };

	if (text === "\u001b[5~") return { key: "pageup", ctrl: false, shift: false };

	if (text === "\u001b[6~") return { key: "pagedown", ctrl: false, shift: false };

	if (text === "\u001b[H" || text === "\u001b[1~") return { key: "home", ctrl: false, shift: false };

	if (text === "\u001b[F" || text === "\u001b[4~") return { key: "end", ctrl: false, shift: false };

	if (text.length === 1) return { key: text, ctrl: false, shift: false };

	return null;
}

export function decodeTerminalKey(text: string): KeyCommand | null {
	return keyFromText(text);
}

function selectionOf(snapshot: SessionSnapshot): InteractionSelection {
	const event = snapshot.selectedEvent;

	if (!event?.metadata) return EMPTY_SELECTION;

	return { tag: tagText(event.rawText, event.metadata.tag), pid: event.metadata.pid };
}

export async function attachTui(
	session: Session,
): Promise<Result<TerminalAttachment & { done: Promise<void> }, UiError>> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return err({ kind: "setup-failed", message: "no TTY available" });
	}

	let interaction: InteractionState = LIST_FOCUS;
	let closed = false;
	let resolveDone: () => void = () => undefined;
	let lastColumns = -1;
	let lastRows = -1;
	let resizeQueued = false;
	let painting = false;

	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	const wasRaw = process.stdin.isRaw;
	const style = paintStyleFromEnv(process.env.NO_COLOR, process.env.FORCE_COLOR);
	process.stdin.setRawMode?.(true);
	process.stdin.resume();
	process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l");

	type TerminalSize = Readonly<{
		columns: number;
		rows: number;
	}>;

	const terminalSize = (): TerminalSize => {
		return {
			columns: Math.max(1, process.stdout.columns ?? 80),
			rows: Math.max(1, process.stdout.rows ?? 24),
		};
	};

	const paint = (): void => {
		if (closed || painting) return;

		painting = true;

		try {
			const size = terminalSize();

			if (size.columns !== lastColumns || size.rows !== lastRows) {
				lastColumns = size.columns;
				lastRows = size.rows;
				session.dispatch({ kind: "resize", columns: size.columns, rows: size.rows });
			}

			const current = session.snapshot();
			const lines = layoutLines(current, interaction, style, size.columns, size.rows);
			let frame = "\x1b[H\x1b[2J";

			for (let i = 0; i < lines.length; i += 1) {
				frame += lines[i];

				if (i < lines.length - 1) frame += "\r\n";
			}

			process.stdout.write(frame);
		} finally {
			painting = false;
		}
	};

	const unsubscribe = session.subscribe(() => {
		paint();
	});

	paint();

	const onData = (chunk: Uint8Array | string): void => {
		const mapped = keyFromText(decodeChunk(chunk));

		if (!mapped) return;

		const snapshot = session.snapshot();

		const result = reduceInteraction(
			interaction,
			{ kind: "key", key: mapped.key, ctrl: mapped.ctrl, shift: mapped.shift },
			snapshot.activeFilter,
			selectionOf(snapshot),
		);

		interaction = result.state;

		if (result.command) session.dispatch(result.command);
		else paint();

		if (result.quit) void shutdown();
	};

	const onResize = (): void => {
		if (resizeQueued) return;

		resizeQueued = true;
		queueMicrotask(() => {
			resizeQueued = false;

			if (closed) return;

			paint();
		});
	};

	process.stdin.on("data", onData);
	process.stdout.on("resize", onResize);

	async function shutdown(): Promise<void> {
		if (closed) return;

		closed = true;
		unsubscribe();
		process.stdin.off("data", onData);
		process.stdout.off("resize", onResize);
		process.stdin.setRawMode?.(wasRaw ?? false);
		process.stdout.write("\x1b[0m\x1b[?25h\x1b[?7h\x1b[?1049l");
		resolveDone();
	}

	return ok({ done, close: shutdown });
}

export { ROW_POOL_OVERSCAN as OVERSCAN };
