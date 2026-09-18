import type { RowKind, RowSpan, ViewRow } from "./commands.ts";
import { clipToWidth, displayWidth, padToWidth } from "./display-text.ts";
import { messageText, tagText } from "./logcat.ts";
import type { EventId, LogEvent, LogLevel } from "./types.ts";
import { CHROME_ROWS, MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from "./types.ts";

export const MARKER_WIDTH = 2;

export const MARKER_SELECTED = "▸ ";

export const MARKER_IDLE = "  ";

export const MAX_LIST_CONTINUATIONS = 6;

export function logViewportHeight(rows: number): number {
	if (rows < MIN_TERMINAL_ROWS) return 0;

	return Math.max(0, rows - CHROME_ROWS);
}

export function requiresResize(columns: number, rows: number): boolean {
	return columns < MIN_TERMINAL_COLUMNS || rows < MIN_TERMINAL_ROWS;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, "0");
}

export function formatTimestamp(epochMicros: number): string {
	const totalMs = Math.floor(epochMicros / 1000);
	const millis = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const sec = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const min = totalMin % 60;
	const hour = Math.floor(totalMin / 60) % 24;

	return `${pad(hour, 2)}:${pad(min, 2)}:${pad(sec, 2)}.${pad(millis, 3)}`;
}

function pushSpan(spans: RowSpan[], text: string, role: RowSpan["role"]): void {
	if (text.length === 0) return;
	spans.push({ text, role });
}

export type ColumnLayout = Readonly<{
	showPid: boolean;
	tagWidth: number;
	messageWidth: number;
	messageColumn: number;
}>;

export function layoutColumns(columns: number): ColumnLayout {
	const inner = Math.max(1, columns - MARKER_WIDTH);
	const timestampWidth = 12;
	const levelWidth = 1;
	const gapTs = 2;
	const gapLevel = 2;
	const gapTag = 2;
	const pidWidth = 5;
	const pidGap = 1;
	const prefix = timestampWidth + gapTs + levelWidth + gapLevel;
	let remaining = inner - prefix;
	let showPid = inner >= 56;
	const tagMax = inner >= 88 ? 16 : inner >= 56 ? 12 : 8;

	if (showPid) remaining -= pidWidth + pidGap;

	if (remaining < 8) {
		showPid = false;
		remaining = inner - prefix;
	}

	let tagWidth = Math.max(0, Math.min(tagMax, Math.floor(remaining * 0.28)));
	let messageWidth = remaining - tagWidth - gapTag;

	if (messageWidth < 8 && tagWidth > 0) {
		const need = 8 - messageWidth;
		tagWidth = Math.max(0, tagWidth - need);
		messageWidth = remaining - tagWidth - gapTag;
	}

	messageWidth = Math.max(1, messageWidth);
	const pidCols = showPid ? pidWidth + pidGap : 0;
	const messageColumn = MARKER_WIDTH + prefix + pidCols + tagWidth + gapTag;

	return { showPid, tagWidth, messageWidth, messageColumn };
}

type PaddedField = Readonly<{
	text: string;
	clipped: boolean;
}>;

function padField(text: string, width: number): PaddedField {
	if (width <= 0) return { text: "", clipped: displayWidth(text) > 0 };

	const clipped = clipToWidth(text, width);
	const pad = Math.max(0, width - clipped.width);

	return { text: `${clipped.text}${" ".repeat(pad)}`, clipped: clipped.clipped };
}

function rowOf(
	event: LogEvent,
	selected: boolean,
	level: LogLevel | null,
	kind: RowKind,
	spans: RowSpan[],
	clipped: boolean,
): ViewRow {
	return { id: event.id, selected, level, kind, spans, clipped };
}

function projectHeader(event: LogEvent, selected: boolean, columns: number, layout: ColumnLayout): ViewRow {
	const spans: RowSpan[] = [];
	let clipped = false;
	const level: LogLevel | null = event.metadata?.level ?? null;

	if (event.metadata) {
		pushSpan(spans, formatTimestamp(event.metadata.epochMicros), "timestamp");
		pushSpan(spans, "  ", "gutter");
		pushSpan(spans, event.metadata.level, "level");
		pushSpan(spans, "  ", "gutter");

		if (layout.showPid) {
			pushSpan(spans, String(event.metadata.pid).padStart(5, " "), "pid");
			pushSpan(spans, " ", "gutter");
		}

		const tag = tagText(event.rawText, event.metadata.tag);
		const tagField = padField(tag, layout.tagWidth);
		clipped = clipped || tagField.clipped;
		pushSpan(spans, tagField.text, "tag");
		pushSpan(spans, "  ", "gutter");
		const message = messageText(event.rawText, event.metadata.message);
		const messageClip = clipToWidth(message, layout.messageWidth);
		clipped = clipped || messageClip.clipped;
		pushSpan(spans, messageClip.text, "message");
	} else {
		const rawClip = clipToWidth(event.rawText, Math.max(1, columns - MARKER_WIDTH));
		clipped = rawClip.clipped;
		pushSpan(spans, rawClip.text, "message");
	}

	if (event.omittedBytes > 0) {
		pushSpan(spans, " [truncated]", "warning");
		clipped = true;
	}

	if (event.invalidUtf8) {
		pushSpan(spans, " [utf8]", "warning");
	}

	return rowOf(event, selected, level, "header", spans, clipped);
}

function continuationIndent(layout: ColumnLayout): string {
	const width = Math.max(0, layout.messageColumn - MARKER_WIDTH);
	const gutter = width >= 2 ? `│ ${" ".repeat(Math.max(0, width - 2))}` : " ".repeat(width);

	return gutter;
}

function projectContinuation(
	event: LogEvent,
	selected: boolean,
	layout: ColumnLayout,
	text: string,
): ViewRow {
	const spans: RowSpan[] = [];
	const indent = continuationIndent(layout);
	pushSpan(spans, indent, "gutter");
	const remaining = Math.max(1, layout.messageWidth);
	const clipped = clipToWidth(text, remaining);
	pushSpan(spans, clipped.text, "message");

	return rowOf(event, selected, event.metadata?.level ?? null, "continuation", spans, clipped.clipped);
}

function projectMore(event: LogEvent, selected: boolean, layout: ColumnLayout, hidden: number): ViewRow {
	const spans: RowSpan[] = [];
	const indent = continuationIndent(layout);
	pushSpan(spans, indent, "gutter");
	pushSpan(spans, `+${hidden} more`, "warning");

	return rowOf(event, selected, event.metadata?.level ?? null, "more", spans, false);
}

export function eventScreenRows(event: LogEvent): number {
	const extra = event.continuations.length;

	if (extra === 0) return 1;

	if (extra <= MAX_LIST_CONTINUATIONS) return 1 + extra;

	return 1 + MAX_LIST_CONTINUATIONS + 1;
}

export function projectEventRows(event: LogEvent, selectedId: EventId | null, columns: number): ViewRow[] {
	const layout = layoutColumns(Math.max(1, columns));
	const selected = event.id === selectedId;
	const rows: ViewRow[] = [projectHeader(event, selected, columns, layout)];
	const limit = Math.min(event.continuations.length, MAX_LIST_CONTINUATIONS);

	for (let i = 0; i < limit; i += 1) {
		rows.push(projectContinuation(event, selected, layout, event.continuations[i]!));
	}

	if (event.continuations.length > MAX_LIST_CONTINUATIONS) {
		rows.push(projectMore(event, selected, layout, event.continuations.length - MAX_LIST_CONTINUATIONS));
	}

	return rows;
}

export function projectRows(
	events: readonly LogEvent[],
	selectedId: EventId | null,
	columns: number,
	maxRows?: number,
): readonly ViewRow[] {
	const rows: ViewRow[] = [];
	const limit = maxRows === undefined ? Number.POSITIVE_INFINITY : maxRows;

	for (const event of events) {
		const projected = projectEventRows(event, selectedId, columns);

		for (const row of projected) {
			if (rows.length >= limit) return rows;

			rows.push(row);
		}
	}

	return rows;
}

export function rowText(row: ViewRow): string {
	let text = "";

	for (const span of row.spans) text += span.text;

	return text;
}

export function rowDisplayText(row: ViewRow): string {
	const marker = row.selected && row.kind === "header" ? MARKER_SELECTED : MARKER_IDLE;

	return `${marker}${rowText(row)}`;
}

export function markerFor(row: ViewRow): string {
	if (row.selected && row.kind === "header") return MARKER_SELECTED;

	return MARKER_IDLE;
}

export function fitRow(row: ViewRow, columns: number): string {
	return padToWidth(rowDisplayText(row), columns);
}
