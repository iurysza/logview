import {
	CHROME_ROWS,
	EMPTY_SELECTION,
	LIST_FOCUS,
	classificationColumnLayout,
	type FilterSpec,
	padToWidth,
	projectColumnHeader,
	reduceInteraction,
	tagText,
	type InteractionSelection,
	type InteractionState,
	type QueryCandidates,
	EMPTY_CANDIDATES,
	err,
	ok,
	type Result,
} from "@logcayo/core";
import type { Session, SessionSnapshot, TerminalAttachment, UiError } from "@logcayo/engine";
import { paintChrome, paintFilled, paintRow, paintStyleFromEnv, type PaintStyle } from "./color.ts";
import {
	emptyMatchCopy,
	formatFilter,
	formatFooter,
	formatHints,
	formatStatus,
	paintChromeLine,
	paintFilterLine,
	paintFooter,
	paintStatus,
} from "./chrome.ts";
import { copyToClipboard, formatClipboardEvent } from "./clipboard.ts";
import { inspectorHeader, inspectorWidth, paintInspector } from "./inspect.ts";
import { THEME } from "./theme.ts";
import type { Rgb } from "./catppuccin.ts";

export { formatFilter, formatFooter, formatHints, formatStatus };

export const ROW_POOL_OVERSCAN = 2;

export const INSPECT_WIDE_COLUMNS = 120;

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

function helpLines(width: number): string[] {
	const lines = [
		"Keys",
		"↑↓ / j k     select previous or next event",
		"PgUp PgDn / ^U ^D  move one page",
		"G / End      follow newest logs · Home first event",
		"w            toggle line wrapping",
		"~            ask Jev in the query: / ~database locks",
		"m · v        switch literal/Jev · hide or dim weak Jev rows",
		"h            fill empty list space",
		"y            copy selected event",
		"Enter        inspect event · t tag · p PID · y copy",
		"/            query  Tab complete  x clear  u undo  c copy",
		"f            change filters",
	];

	const fitted: string[] = [];

	for (const line of lines) fitted.push(padToWidth(line, width));

	return fitted;
}

type JevNote = Readonly<{ bar: string; rest: string; label: string; color: "purple" | "subtle" | "red" | "muted" }>;

const BAR_CELLS = 5;

/** A 5-cell bar plus score, e.g. `━━━━╌ 0.93`; compact widths show only the score. */
function jevNote(row: SessionSnapshot["rows"][number], compact: boolean, threshold: number): JevNote {
	const mark = row.classification;

	if (mark.kind === "scored") {
		const filled = Math.max(1, Math.round(mark.relevance * BAR_CELLS));
		const score = mark.relevance.toFixed(2);

		return {
			bar: compact ? "" : "━".repeat(filled),
			rest: compact ? "" : "╌".repeat(BAR_CELLS - filled),
			label: compact ? score : ` ${score}`,
			color: mark.relevance >= threshold ? "purple" : "subtle",
		};
	}

	if (mark.kind === "pending") return { bar: "", rest: "", label: "\uf017", color: "muted" };

	if (mark.kind === "unrequested") return { bar: "", rest: "", label: "\uf10c", color: "subtle" };

	if (mark.kind === "unknown") {
		if (mark.reason === "failed") return { bar: "", rest: "", label: compact ? "\uf057 fail" : "\uf057 failed", color: "subtle" };

		if (mark.reason === "skipped") return { bar: "", rest: "", label: compact ? "\uf05e skip" : "\uf05e skipped", color: "subtle" };

		if (mark.reason === "too-large") return { bar: "", rest: "", label: "too large", color: "subtle" };

		return { bar: "", rest: "", label: "unsupported", color: "subtle" };
	}

	return { bar: "", rest: "", label: "", color: "subtle" };
}

function paintJevNote(note: JevNote, width: number, style: PaintStyle, background: Rgb): string {
	const color = THEME[note.color];
	const text = padToWidth(`${note.bar}${note.rest}${note.label}`, width);

	if (style === "plain") return text;

	const bar = [...note.bar].length;
	const rest = [...note.rest].length;
	const chars = [...text];

	return [
		paintChrome(" ", color, style, background),
		paintChrome(chars.slice(0, bar).join(""), color, style, background),
		paintChrome(chars.slice(bar, bar + rest).join(""), THEME.subtle, style, background),
		paintChrome(chars.slice(bar + rest, width - 1).join(""), color, style, background),
	].join("");
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
	listBackground: boolean,
	emptyCopy: readonly string[] | null,
	filter: FilterSpec,
): string[] {
	const lines: string[] = [];

	if (rows.length === 0 && emptyCopy) {
		for (const text of emptyCopy) {
			if (lines.length >= count) break;

			lines.push(paintFilled(text, columns, style, THEME.muted, listBackground ? THEME.canvas : null));
		}
	}

	if (semantic === null) {
		for (const row of rows) {
			if (lines.length >= count) break;

			lines.push(paintRow(row, style, columns, { filter }));
		}
	} else {
		const jevLayout = classificationColumnLayout(columns);

		for (const row of rows) {
			if (lines.length >= count) break;

			const dimmed = isBelowJevThreshold(row, semantic.threshold);
			const logLine = paintRow(row, style, jevLayout.listWidth, { dimmed, filter });
			const divider = style === "plain" ? "│" : paintChrome("│", THEME.subtle, style);
			const background = row.selected ? THEME.selection : THEME.canvas;
			const note = row.kind === "header" ? jevNote(row, jevLayout.noteWidth < 14, semantic.threshold) : null;

			const noteLine = note === null
				? paintChrome(padToWidth("", jevLayout.noteWidth), THEME.subtle, style, background)
				: paintJevNote(note, jevLayout.noteWidth, style, background);

			lines.push(`${logLine}${divider}${noteLine}`);
		}
	}

	while (lines.length < count) {
		lines.push(
			listBackground
				? paintFilled("", columns, style, THEME.text, THEME.canvas)
				: padToWidth("", columns),
		);
	}

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
	const width = inspectorWidth(columns);
	const leftWidth = Math.max(1, columns - width - 1);
	const out: string[] = [];

	for (let i = 0; i < logLines.length; i += 1) {
		const left = logLines[i] ?? padToWidth("", leftWidth);
		const right = pane[i] ?? paintChromeLine([], width, style, THEME.bar);
		const divider = style === "plain" ? "│" : paintChromeLine([{ text: "│", style: { fg: THEME.subtle, bg: null, bold: false, italic: false } }], 1, style, THEME.canvas);

		out.push(`${left}${divider}${right}`);
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
	listBackground = true,
	candidates: QueryCandidates = EMPTY_CANDIDATES,
): readonly string[] {
	if (rows <= 0 || columns <= 0) return [];

	if (snapshot.notice === "resize-required") {
		const lines = [padToWidth("Terminal too small. Resize to at least 40x8. Ingestion continues.", columns)];

		while (lines.length < rows) lines.push(padToWidth("", columns));

		return lines.slice(0, rows);
	}

	const header = [
		paintStatus(snapshot, columns, style),
		paintFilterLine(snapshot, interaction, columns, style, candidates),
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

	const footerPadding = paintChromeLine([], columns, style, THEME.bar);
	const footer = [footerPadding, paintFooter(snapshot, interaction, columns, style), footerPadding];
	const viewport = Math.max(0, rows - CHROME_ROWS);
	const inspectOpen = interaction.focus === "inspect";
	const helpOpen = interaction.focus === "help";
	const wideInspect = inspectOpen && columns >= INSPECT_WIDE_COLUMNS;
	const logWidth = wideInspect ? Math.max(1, columns - inspectorWidth(columns) - 1) : columns;
	const semantic = snapshot.searchMode === "jev" && snapshot.activeFilter.text.length > 0 ? snapshot.semantic : null;

	let body = paintLogRows(
		snapshot.rows,
		logWidth,
		viewport,
		style,
		semantic,
		listBackground,
		emptyMatchCopy(snapshot),
		snapshot.activeFilter,
	);

	const selectedRow = selectedHeaderRow(snapshot);
	const classification = classificationLabel(selectedRow);

	if (helpOpen) {
		header[2] = paintChromeLine([{ text: "Keys", style: { fg: THEME.muted, bg: null, bold: true, italic: false } }], columns, style, THEME.bar);
		body = fillPane(helpLines(columns).slice(1), viewport, columns, style);
	} else if (inspectOpen && !wideInspect) {
		header[2] = paintChromeLine(inspectorHeader(snapshot.selectedEvent, columns), columns, style, THEME.bar);
		body = paintInspector(snapshot.selectedEvent, columns, viewport, style, classification, snapshot.packageAttribution);
	} else if (wideInspect) {
		const paneWidth = inspectorWidth(columns);
		const leftWidth = Math.max(1, columns - paneWidth - 1);
		const headingText = projectColumnHeader(columns).map((span) => span.text).join("");
		header[2] = paintChromeLine(
			[
				{ text: padToWidth(headingText, leftWidth), style: { fg: THEME.muted, bg: null, bold: true, italic: false } },
				{ text: "│", style: { fg: THEME.subtle, bg: null, bold: false, italic: false } },
				...inspectorHeader(snapshot.selectedEvent, paneWidth),
			],
			columns,
			style,
			THEME.bar,
		);
		body = splitPane(
			body,
			paintInspector(snapshot.selectedEvent, paneWidth, viewport, style, classification, snapshot.packageAttribution),
			columns,
			style,
		);
	}

	const lines = [...header, ...body, ...footer];

	while (lines.length < rows) lines.push(padToWidth("", columns));

	return lines.slice(0, rows);
}

export function layoutSession(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	style: PaintStyle = "plain",
	columns = 80,
	rows = 24,
	listBackground = true,
): readonly string[] {
	return layoutLines(snapshot, interaction, style, columns, rows, listBackground);
}

export function paintFrame(lines: readonly string[]): string {
	let frame = "\x1b[?2026h\x1b[H";

	for (let i = 0; i < lines.length; i += 1) {
		frame += lines[i];

		if (i < lines.length - 1) frame += "\r\n";
	}

	return `${frame}\x1b[?2026l`;
}

export function layoutFrame(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	columns: number,
	rows: number,
	style: PaintStyle = "plain",
	listBackground = true,
	candidates: QueryCandidates = EMPTY_CANDIDATES,
): readonly string[] {
	return layoutLines(snapshot, interaction, style, columns, rows, listBackground, candidates);
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
	let listBackground = true;
	let closed = false;
	let resolveDone: () => void = () => undefined;
	let lastColumns = -1;
	let lastRows = -1;
	let lastFrame: string | null = null;
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
				lastFrame = null;
				session.dispatch({ kind: "resize", columns: size.columns, rows: size.rows });
			}

			const current = resized ? session.snapshot() : (published ?? session.snapshot());
			const candidates = interaction.focus === "query" ? session.queryCandidates() : EMPTY_CANDIDATES;
			const frame = paintFrame(layoutLines(current, interaction, style, size.columns, size.rows, listBackground, candidates));

			if (frame === lastFrame) return;

			lastFrame = frame;
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

			if (interaction.focus === "list" && (mapped.key === "h" || mapped.key === "H")) {
				listBackground = !listBackground;
				paint();
				continue;
			}

			if ((interaction.focus === "list" || interaction.focus === "inspect") && (mapped.key === "y" || mapped.key === "Y")) {
				if (snapshot.selectedEvent) void copyToClipboard(formatClipboardEvent(snapshot.selectedEvent));
				paint();
				continue;
			}

			const result = reduceInteraction(
				interaction,
				{ kind: "key", key: mapped.key, ctrl: mapped.ctrl, shift: mapped.shift },
				snapshot.activeFilter,
				selectionOf(snapshot),
				snapshot.searchMode,
				{ semanticAvailable: snapshot.semantic !== null, candidates: session.queryCandidates() },
			);

			if (result.effect?.kind === "copy") void copyToClipboard(result.effect.text);

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
