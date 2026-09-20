import { NONE_CLASSIFICATION, type ClassificationMark, type RowKind, type RowSpan, type ViewRow } from "./commands.ts";
import { clipToWidth, displayWidth, escapeDisplayText, padToWidth } from "./display-text.ts";
import { messageText, tagText } from "./logcat.ts";
import type { EventId, LogEvent, LogLevel } from "./types.ts";
import { CHROME_ROWS, MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from "./types.ts";

export const MARKER_WIDTH = 2;

export const MARKER_SELECTED = "▸ ";

export const MARKER_IDLE = "  ";

export const MARKER_PENDING = "? ";

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

export type ProcessColumn =
	| Readonly<{ kind: "none"; width: 0 }>
	| Readonly<{ kind: "pid"; width: 5 }>
	| Readonly<{ kind: "pid-tid"; width: 11 }>;

export type ColumnLayout = Readonly<{
	showPid: boolean;
	process: ProcessColumn;
	tagWidth: number;
	messageWidth: number;
	messageColumn: number;
}>;

export type ClassificationColumnLayout = Readonly<{
	listWidth: number;
	noteWidth: number;
}>;

export function classificationColumnLayout(columns: number): ClassificationColumnLayout {
	const noteWidth = columns >= 64 ? 14 : 7;

	return { listWidth: Math.max(1, columns - noteWidth - 1), noteWidth };
}

const TIMESTAMP_WIDTH = 12;

const LEVEL_WIDTH = 3;

const GAP_AFTER_TIMESTAMP = 2;

const GAP_AFTER_LEVEL = 2;

const GAP_AFTER_PROCESS = 1;

const GAP_AFTER_TAG = 2;

export function layoutColumns(columns: number): ColumnLayout {
	const inner = Math.max(1, columns - MARKER_WIDTH);
	const prefix = TIMESTAMP_WIDTH + GAP_AFTER_TIMESTAMP + LEVEL_WIDTH + GAP_AFTER_LEVEL;

	let process: ProcessColumn =
		columns >= 90
			? { kind: "pid-tid", width: 11 }
			: columns >= 58
				? { kind: "pid", width: 5 }
				: { kind: "none", width: 0 };

	let remaining = inner - prefix;

	if (process.kind !== "none") remaining -= process.width + GAP_AFTER_PROCESS;

	if (remaining < 8) {
		process = { kind: "none", width: 0 };
		remaining = inner - prefix;
	}

	const tagMax = columns >= 90 ? 16 : columns >= 58 ? 12 : 8;
	let tagWidth = Math.max(0, Math.min(tagMax, Math.floor(remaining * 0.28)));
	let messageWidth = remaining - tagWidth - GAP_AFTER_TAG;

	if (messageWidth < 8 && tagWidth > 0) {
		const need = 8 - messageWidth;
		tagWidth = Math.max(0, tagWidth - need);
		messageWidth = remaining - tagWidth - GAP_AFTER_TAG;
	}

	messageWidth = Math.max(1, messageWidth);
	const processColumns = process.kind === "none" ? 0 : process.width + GAP_AFTER_PROCESS;
	const messageColumn = MARKER_WIDTH + prefix + processColumns + tagWidth + GAP_AFTER_TAG;

	return { showPid: process.kind !== "none", process, tagWidth, messageWidth, messageColumn };
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
	classification: ClassificationMark = NONE_CLASSIFICATION,
): ViewRow {
	return { id: event.id, selected, level, kind, spans, clipped, classification };
}

type ProjectedText = Readonly<{ text: string; clipped: boolean }>;

function projectText(text: string, width: number, lineDisplay: "clip" | "wrap"): readonly ProjectedText[] {
	if (lineDisplay === "clip") {
		const clipped = clipToWidth(text, width);

		return [{ text: clipped.text, clipped: clipped.clipped }];
	}

	const lines: ProjectedText[] = [];
	let line = "";
	let used = 0;

	for (const unit of escapeDisplayText(text)) {
		if (used > 0 && used + unit.width > width) {
			lines.push({ text: line, clipped: false });
			line = "";
			used = 0;
		}

		if (unit.width > width) {
			if (line.length > 0) lines.push({ text: line, clipped: false });
			lines.push({ text: clipToWidth(unit.display, width).text, clipped: false });
			line = "";
			used = 0;
			continue;
		}

		line += unit.display;
		used += unit.width;
	}

	if (line.length > 0 || lines.length === 0) lines.push({ text: line, clipped: false });

	return lines;
}

function projectHeader(
	event: LogEvent,
	selected: boolean,
	layout: ColumnLayout,
	message: ProjectedText,
): ViewRow {
	const spans: RowSpan[] = [];
	let clipped = message.clipped;
	const level: LogLevel | null = event.metadata?.level ?? null;

	if (event.metadata) {
		pushSpan(spans, formatTimestamp(event.metadata.epochMicros), "timestamp");
		pushSpan(spans, "  ", "gutter");
		pushSpan(spans, event.metadata.level.padStart(2, " "), "level");
		pushSpan(spans, "  ", "gutter");

		if (layout.process.kind !== "none") {
			const process =
				layout.process.kind === "pid-tid"
					? `${event.metadata.pid}:${event.metadata.tid}`
					: String(event.metadata.pid);

			const processField = padField(process.padStart(layout.process.width, " "), layout.process.width);
			clipped = clipped || processField.clipped;
			pushSpan(spans, processField.text, "pid");
			pushSpan(spans, " ", "gutter");
		}

		const tag = tagText(event.rawText, event.metadata.tag);
		const tagField = padField(tag, layout.tagWidth);
		clipped = clipped || tagField.clipped;
		pushSpan(spans, tagField.text, "tag");
		pushSpan(spans, "  ", "gutter");
	}

	pushSpan(spans, message.text, "message");

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
	text: ProjectedText,
): ViewRow {
	const spans: RowSpan[] = [];
	pushSpan(spans, continuationIndent(layout), "gutter");
	pushSpan(spans, text.text, "message");

	return rowOf(event, selected, event.metadata?.level ?? null, "continuation", spans, text.clipped);
}

function projectMore(event: LogEvent, selected: boolean, layout: ColumnLayout, hidden: number): ViewRow {
	const spans: RowSpan[] = [];
	pushSpan(spans, continuationIndent(layout), "gutter");
	pushSpan(spans, `+${hidden} more`, "warning");

	return rowOf(event, selected, event.metadata?.level ?? null, "more", spans, false);
}

function eventMessage(event: LogEvent): string {
	return event.metadata ? messageText(event.rawText, event.metadata.message) : event.rawText;
}

function messageWidth(event: LogEvent, columns: number, layout: ColumnLayout): number {
	return event.metadata ? layout.messageWidth : Math.max(1, columns - MARKER_WIDTH);
}

export function eventScreenRows(event: LogEvent, columns = 80, lineDisplay: "clip" | "wrap" = "clip"): number {
	if (lineDisplay === "clip") {
		const extra = event.continuations.length;

		if (extra === 0) return 1;

		if (extra <= MAX_LIST_CONTINUATIONS) return 1 + extra;

		return 1 + MAX_LIST_CONTINUATIONS + 1;
	}

	const layout = layoutColumns(Math.max(1, columns));
	const width = messageWidth(event, columns, layout);
	let rows = projectText(eventMessage(event), width, lineDisplay).length;
	const limit = Math.min(event.continuations.length, MAX_LIST_CONTINUATIONS);

	for (let i = 0; i < limit; i += 1) {
		rows += projectText(event.continuations[i]!, layout.messageWidth, lineDisplay).length;
	}

	return event.continuations.length > MAX_LIST_CONTINUATIONS ? rows + 1 : rows;
}

export function projectEventRows(
	event: LogEvent,
	selectedId: EventId | null,
	columns: number,
	lineDisplay: "clip" | "wrap" = "clip",
): ViewRow[] {
	const layout = layoutColumns(Math.max(1, columns));
	const selected = event.id === selectedId;
	const message = projectText(eventMessage(event), messageWidth(event, columns, layout), lineDisplay);
	const rows: ViewRow[] = [projectHeader(event, selected, layout, message[0]!)];

	for (const line of message.slice(1)) rows.push(projectContinuation(event, selected, layout, line));

	const limit = Math.min(event.continuations.length, MAX_LIST_CONTINUATIONS);

	for (let i = 0; i < limit; i += 1) {
		for (const line of projectText(event.continuations[i]!, layout.messageWidth, lineDisplay)) {
			rows.push(projectContinuation(event, selected, layout, line));
		}
	}

	if (event.continuations.length > MAX_LIST_CONTINUATIONS) {
		rows.push(projectMore(event, selected, layout, event.continuations.length - MAX_LIST_CONTINUATIONS));
	}

	return rows;
}

export function projectColumnHeader(columns: number): readonly RowSpan[] {
	const layout = layoutColumns(Math.max(1, columns));
	const spans: RowSpan[] = [];
	pushSpan(spans, " ".repeat(MARKER_WIDTH), "gutter");
	pushSpan(spans, "TIME".padEnd(TIMESTAMP_WIDTH, " "), "timestamp");
	pushSpan(spans, " ".repeat(GAP_AFTER_TIMESTAMP), "gutter");
	pushSpan(spans, "LVL", "level");
	pushSpan(spans, " ".repeat(GAP_AFTER_LEVEL), "gutter");

	if (layout.process.kind !== "none") {
		const label = layout.process.kind === "pid-tid" ? "PID:TID" : "PID";
		pushSpan(spans, label.padStart(layout.process.width, " "), "pid");
		pushSpan(spans, " ".repeat(GAP_AFTER_PROCESS), "gutter");
	}

	pushSpan(spans, padField("TAG", layout.tagWidth).text, "tag");
	pushSpan(spans, " ".repeat(GAP_AFTER_TAG), "gutter");
	pushSpan(spans, clipToWidth("MESSAGE", layout.messageWidth).text, "message");

	return spans;
}

export function projectRows(
	events: readonly LogEvent[],
	selectedId: EventId | null,
	columns: number,
	maxRows?: number,
	lineDisplay: "clip" | "wrap" = "clip",
): readonly ViewRow[] {
	const rows: ViewRow[] = [];
	const limit = maxRows === undefined ? Number.POSITIVE_INFINITY : maxRows;

	for (const event of events) {
		const projected = projectEventRows(event, selectedId, columns, lineDisplay);

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
	return `${markerFor(row)}${rowText(row)}`;
}

export function markerFor(row: ViewRow): string {
	if (row.selected && row.kind === "header") return MARKER_SELECTED;

	if (row.kind === "header" && row.classification.kind !== "none" && row.classification.kind !== "scored") {
		return MARKER_PENDING;
	}

	return MARKER_IDLE;
}

export function fitRow(row: ViewRow, columns: number): string {
	return padToWidth(rowDisplayText(row), columns);
}
