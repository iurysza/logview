import type { RowSpan, ViewRow } from "./commands.ts";
import { clipToWidth } from "./display-text.ts";
import { messageText, tagText } from "./logcat.ts";
import type { EventId, LogEvent, LogLevel } from "./types.ts";
import { CHROME_ROWS, MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from "./types.ts";

const CLIP_MARK = "…";

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

function layoutColumns(columns: number): {
	showPid: boolean;
	tagWidth: number;
	messageWidth: number;
} {
	const timestampWidth = 12;
	const levelWidth = 1;
	const gaps = 4;
	const pidWidth = 5;
	let remaining = columns - timestampWidth - levelWidth - gaps;
	let showPid = remaining >= 18;
	if (showPid) remaining -= pidWidth + 1;
	if (remaining < 4) {
		showPid = false;
		remaining = columns - timestampWidth - levelWidth - 3;
	}
	const tagWidth = Math.max(0, Math.min(16, Math.floor(remaining * 0.3)));
	const messageWidth = Math.max(1, remaining - tagWidth);
	return { showPid, tagWidth, messageWidth };
}

function clipField(text: string, width: number): { text: string; clipped: boolean } {
	if (width <= 0) return { text: "", clipped: text.length > 0 };
	const clipped = clipToWidth(text, width);
	return clipped;
}

export function projectRows(
	events: readonly LogEvent[],
	selectedId: EventId | null,
	columns: number,
): readonly ViewRow[] {
	const layout = layoutColumns(Math.max(1, columns));
	const rows: ViewRow[] = [];
	for (const event of events) {
		const spans: RowSpan[] = [];
		let clipped = false;
		const selected = event.id === selectedId;
		const level: LogLevel | null = event.metadata?.level ?? null;
		if (event.metadata) {
			pushSpan(spans, formatTimestamp(event.metadata.epochMicros), "timestamp");
			pushSpan(spans, "  ", "message");
			pushSpan(spans, event.metadata.level, "level");
			pushSpan(spans, "  ", "message");
			if (layout.showPid) {
				pushSpan(spans, String(event.metadata.pid).padStart(5, " "), "message");
				pushSpan(spans, " ", "message");
			}
			const tag = tagText(event.rawText, event.metadata.tag);
			const tagClip = clipField(tag, layout.tagWidth);
			clipped = clipped || tagClip.clipped;
			pushSpan(spans, tagClip.text.padEnd(layout.tagWidth, " "), "tag");
			pushSpan(spans, "  ", "message");
			const message = messageText(event.rawText, event.metadata.message);
			const messageClip = clipField(message, layout.messageWidth);
			clipped = clipped || messageClip.clipped;
			pushSpan(spans, messageClip.text, "message");
		} else {
			const rawClip = clipField(event.rawText, Math.max(1, columns - 2));
			clipped = rawClip.clipped;
			pushSpan(spans, rawClip.text, "message");
		}
		if (event.omittedBytes > 0) {
			pushSpan(spans, " [truncated]", "warning");
			clipped = true;
		} else if (clipped) {
			const last = spans[spans.length - 1];
			if (last && last.role === "message" && !last.text.endsWith(CLIP_MARK)) {
				spans[spans.length - 1] = { ...last, text: last.text };
			}
		}
		if (event.invalidUtf8) {
			pushSpan(spans, " [utf8]", "warning");
		}
		rows.push({
			id: event.id,
			selected,
			level,
			spans,
			clipped,
		});
	}
	return rows;
}

export function rowText(row: ViewRow): string {
	return row.spans.map((span) => span.text).join("");
}
