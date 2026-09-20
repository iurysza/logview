import {
	CHROME_ROWS,
	EMPTY_SELECTION,
	LIST_FOCUS,
	classificationColumnLayout,
	formatTimestamp,
	messageText,
	padToWidth,
	projectColumnHeader,
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
import { paintChrome, paintFilled, paintRow, paintStyleFromEnv, type PaintStyle } from "./color.ts";
import {
	formatFilter,
	formatFooter,
	formatHints,
	formatStatus,
	paintChromeLine,
	paintFilterLine,
	paintFooter,
	paintStatus,
} from "./chrome.ts";
import { THEME } from "./theme.ts";

export { formatFilter, formatFooter, formatHints, formatStatus };

export const ROW_POOL_OVERSCAN = 2;

export const INSPECT_WIDE_COLUMNS = 120;

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

	if (row.classification.kind === "scored") return row.classification.relevance.toFixed(2);

	if (row.classification.kind === "pending") return " pending";

	if (row.classification.kind === "unrequested") return " not requested";

	if (row.classification.reason === "failed") return " failed";

	if (row.classification.reason === "skipped") return " skipped";

	return row.classification.reason;
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
		"PgUp PgDn / ^U ^D  page",
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

function jevNote(row: SessionSnapshot["rows"][number], compact: boolean): string {
	if (row.classification.kind === "scored") return row.classification.relevance.toFixed(2);

	if (row.classification.kind === "pending") return "";

	if (row.classification.kind === "unrequested") return "";

	if (row.classification.kind === "unknown") {
		if (row.classification.reason === "failed") return compact ? " fail" : " failed";

		if (row.classification.reason === "skipped") return compact ? " skip" : " skipped";

		if (row.classification.reason === "too-large") return "too large";

		return "unsupported";
	}

	return "";
}

function isBelowJevThreshold(row: SessionSnapshot["rows"][number], threshold: number): boolean {
	return row.classification.kind === "scored" && row.classification.relevance < threshold;
}

function paintLogRows(
	rows: SessionSnapshot["rows"],
	columns: number,
	count: number,
	style: PaintStyle,
	semantic: SessionSnapshot["semantic"],
): string[] {
	const lines: string[] = [];

	if (semantic === null) {
		for (const row of rows) {
			if (lines.length >= count) break;

			lines.push(paintRow(row, style, columns));
		}
	} else {
		const jevLayout = classificationColumnLayout(columns);

		for (const row of rows) {
			if (lines.length >= count) break;

			const dimmed = isBelowJevThreshold(row, semantic.threshold);
			const logLine = paintRow(row, style, jevLayout.listWidth, { dimmed });
			const divider = style === "plain" ? "│" : paintChrome("│", THEME.subtle, style);
			const note = row.kind === "header" ? jevNote(row, jevLayout.noteWidth < 14) : "";
			const noteColor = dimmed ? THEME.subtle : THEME.muted;
			const background = row.selected ? THEME.selection : THEME.canvas;
			const noteLine = paintChrome(padToWidth(note, jevLayout.noteWidth), noteColor, style, background);

			lines.push(`${logLine}${divider}${noteLine}`);
		}
	}

	while (lines.length < count) lines.push(padToWidth("", columns));

	return lines;
}

function fillPane(pane: string[], count: number, columns: number, style: PaintStyle): string[] {
	const lines: string[] = [];

	for (let i = 0; i < count; i += 1) {
		const text = pane[i] ?? "";
		lines.push(paintFilled(text.trimEnd(), columns, style, THEME.text, style === "ansi" ? THEME.bar : null));
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
		const divider = style === "plain" ? "│" : paintChromeLine([{ text: "│", style: { fg: THEME.subtle, bg: null, bold: false, italic: false } }], 1, style, THEME.canvas);

		const rightPainted =
			style === "plain" ? right : paintFilled(right.trimEnd(), width, style, THEME.text, THEME.bar);

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
		paintChromeLine(
			projectColumnHeader(columns).map((span) => ({
				text: span.text,
				style: { fg: THEME.muted, bg: null, bold: true, italic: false },
			})),
			columns,
			style,
			THEME.bar,
		),
	];

	const footer = paintFooter(snapshot, interaction, columns, style);
	const viewport = Math.max(0, rows - CHROME_ROWS);
	const inspectOpen = interaction.focus === "inspect";
	const helpOpen = interaction.focus === "help";
	const wideInspect = inspectOpen && columns >= INSPECT_WIDE_COLUMNS;
	const logWidth = wideInspect ? Math.max(1, columns - inspectWidth(columns) - 1) : columns;
	const semantic = snapshot.semantic !== null && snapshot.activeFilter.text.length > 0 ? snapshot.semantic : null;
	let body = paintLogRows(snapshot.rows, logWidth, viewport, style, semantic);
	const selectedRow = selectedHeaderRow(snapshot);
	const classification = classificationLabel(selectedRow);

	if (helpOpen) {
		header[2] = paintChromeLine([{ text: "Keys", style: { fg: THEME.muted, bg: null, bold: true, italic: false } }], columns, style, THEME.bar);
		body = fillPane(helpLines(columns).slice(1), viewport, columns, style);
	} else if (inspectOpen && !wideInspect) {
		header[2] = paintChromeLine([{ text: "Event", style: { fg: THEME.muted, bg: null, bold: true, italic: false } }], columns, style, THEME.bar);
		body = fillPane(
			inspectLines(snapshot.selectedEvent, columns, viewport, classification).slice(2),
			viewport,
			columns,
			style,
		);
	} else if (wideInspect) {
		const paneWidth = inspectWidth(columns);
		const leftWidth = Math.max(1, columns - paneWidth - 1);
		const headingText = projectColumnHeader(columns).map((span) => span.text).join("");
		header[2] = paintChromeLine(
			[
				{ text: padToWidth(headingText, leftWidth), style: { fg: THEME.muted, bg: null, bold: true, italic: false } },
				{ text: "│", style: { fg: THEME.subtle, bg: null, bold: false, italic: false } },
				{ text: "Event", style: { fg: THEME.muted, bg: null, bold: true, italic: false } },
			],
			columns,
			style,
			THEME.bar,
		);
		body = splitPane(
			body,
			inspectLines(snapshot.selectedEvent, inspectWidth(columns), viewport, classification).slice(2),
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

export type DecodedTerminalInput = Readonly<{
	keys: readonly KeyCommand[];
	rest: string;
}>;

const PLAIN_KEY = { ctrl: false, shift: false } as const;

const ESCAPE_SEQUENCES: ReadonlyArray<readonly [string, KeyCommand]> = [
	["\u001b[5~", { key: "pageup", ...PLAIN_KEY }],
	["\u001b[6~", { key: "pagedown", ...PLAIN_KEY }],
	["\u001b[1~", { key: "home", ...PLAIN_KEY }],
	["\u001b[4~", { key: "end", ...PLAIN_KEY }],
	["\u001b[Z", { key: "tab", ctrl: false, shift: true }],
	["\u001b[A", { key: "up", ...PLAIN_KEY }],
	["\u001b[B", { key: "down", ...PLAIN_KEY }],
	["\u001b[H", { key: "home", ...PLAIN_KEY }],
	["\u001b[F", { key: "end", ...PLAIN_KEY }],
];

const ESCAPE_SEQUENCE_DELAY_MS = 25;

function matchNextKey(
	slice: string,
	deferStandaloneEscape: boolean,
): Readonly<{ key: KeyCommand; size: number }> | "incomplete" {
	if (slice.startsWith("\u0003")) return { key: { key: "c", ctrl: true, shift: false }, size: 1 };

	if (slice.startsWith("\u0004")) return { key: { key: "d", ctrl: true, shift: false }, size: 1 };

	if (slice.startsWith("\u0015")) return { key: { key: "u", ctrl: true, shift: false }, size: 1 };

	if (slice.startsWith("\r") || slice.startsWith("\n")) return { key: { key: "enter", ...PLAIN_KEY }, size: 1 };

	if (slice.startsWith("\t")) return { key: { key: "tab", ...PLAIN_KEY }, size: 1 };

	if (slice.startsWith("\u007f") || slice.startsWith("\b")) {
		return { key: { key: "backspace", ...PLAIN_KEY }, size: 1 };
	}

	if (slice.startsWith("\u001b")) {
		if (slice === "\u001b") return deferStandaloneEscape ? "incomplete" : { key: { key: "escape", ...PLAIN_KEY }, size: 1 };

		for (const [sequence, key] of ESCAPE_SEQUENCES) {
			if (slice.startsWith(sequence)) return { key, size: sequence.length };

			if (sequence.startsWith(slice)) return "incomplete";
		}

		return { key: { key: "escape", ...PLAIN_KEY }, size: 1 };
	}

	return { key: { key: slice[0]!, ...PLAIN_KEY }, size: 1 };
}

export function decodeTerminalInput(
	text: string,
	options: Readonly<{ deferStandaloneEscape?: boolean }> = {},
): DecodedTerminalInput {
	const keys: KeyCommand[] = [];
	let offset = 0;

	while (offset < text.length) {
		const matched = matchNextKey(text.slice(offset), options.deferStandaloneEscape === true);

		if (matched === "incomplete") return { keys, rest: text.slice(offset) };

		keys.push(matched.key);
		offset += matched.size;
	}

	return { keys, rest: "" };
}

export class TerminalInputDecoder {
	private readonly utf8 = new TextDecoder();
	private pending = "";

	push(chunk: Uint8Array | string): DecodedTerminalInput {
		this.pending += chunk instanceof Uint8Array ? this.utf8.decode(chunk, { stream: true }) : chunk;
		const decoded = decodeTerminalInput(this.pending, { deferStandaloneEscape: true });
		this.pending = decoded.rest;

		return decoded;
	}

	hasPending(): boolean {
		return this.pending.length > 0;
	}

	flush(): readonly KeyCommand[] {
		const pending = this.pending;
		this.pending = "";

		if (!pending.startsWith("\u001b")) return decodeTerminalInput(pending).keys;

		const tail = decodeTerminalInput(pending.slice(1)).keys;

		return [{ key: "escape", ...PLAIN_KEY }, ...tail];
	}
}

export function decodeTerminalKey(text: string): KeyCommand | null {
	const decoded = decodeTerminalInput(text);

	if (decoded.rest.length > 0 || decoded.keys.length !== 1) return null;

	return decoded.keys[0] ?? null;
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
	let inputTimer: ReturnType<typeof setTimeout> | null = null;
	const input = new TerminalInputDecoder();

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

	const paint = (published?: SessionSnapshot): void => {
		if (closed || painting) return;

		painting = true;

		try {
			const size = terminalSize();
			const resized = size.columns !== lastColumns || size.rows !== lastRows;

			if (resized) {
				lastColumns = size.columns;
				lastRows = size.rows;
				session.dispatch({ kind: "resize", columns: size.columns, rows: size.rows });
			}

			const current = resized ? session.snapshot() : (published ?? session.snapshot());
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

	const unsubscribe = session.subscribe((snapshot) => {
		paint(snapshot);
	});

	paint();

	const applyKeys = (keys: readonly KeyCommand[]): void => {
		for (const mapped of keys) {
			if (closed) return;

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

			if (result.quit) {
				void shutdown();

				return;
			}
		}
	};

	const flushPendingInput = (): void => {
		inputTimer = null;
		applyKeys(input.flush());
	};

	const onData = (chunk: Uint8Array | string): void => {
		if (inputTimer !== null) {
			clearTimeout(inputTimer);
			inputTimer = null;
		}

		applyKeys(input.push(chunk).keys);

		if (input.hasPending() && !closed) {
			inputTimer = setTimeout(flushPendingInput, ESCAPE_SEQUENCE_DELAY_MS);
		}
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

		if (inputTimer !== null) clearTimeout(inputTimer);
		unsubscribe();
		process.stdin.off("data", onData);
		process.stdin.pause();
		process.stdout.off("resize", onResize);
		process.stdin.setRawMode?.(wasRaw ?? false);
		process.stdout.write("\x1b[0m\x1b[?25h\x1b[?7h\x1b[?1049l");
		resolveDone();
	}

	return ok({ done, close: shutdown });
}

export { ROW_POOL_OVERSCAN as OVERSCAN };
