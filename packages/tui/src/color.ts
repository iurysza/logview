import {
	clipToWidth,
	displayWidth,
	EMPTY_FILTER,
	markerFor,
	textMatchRanges,
	type FilterSpec,
	type LogLevel,
	type RowSpan,
	type ViewRow,
} from "@logview/core";
import { fgBold, fgOnly, paintStyled, RESET, rgbSgr, styleOn, type Rgb } from "./catppuccin.ts";
import { highlightLogText } from "./highlight.ts";
import { severityStyle, THEME } from "./theme.ts";

export type PaintStyle = "plain" | "ansi";

export function paintStyleFromEnv(noColor: string | undefined, forceColor: string | undefined): PaintStyle {
	if (noColor !== undefined && noColor.length > 0) return "plain";

	if (forceColor === "0") return "plain";

	return "ansi";
}

function levelStyle(level: LogLevel | null) {
	return severityStyle(level);
}

function paintMessageSlice(text: string, bg: Rgb | null, dimmed: boolean): string {
	if (dimmed) return paintStyled(text, styleOn(fgOnly(THEME.subtle), bg));

	return highlightLogText(text, bg);
}

function paintMessage(text: string, bg: Rgb | null, filter: FilterSpec, dimmed: boolean): string {
	const ranges = textMatchRanges(text, filter);

	if (ranges.length === 0) return paintMessageSlice(text, bg, dimmed);

	let out = "";
	let cursor = 0;

	for (const range of ranges) {
		if (range.start > cursor) out += paintMessageSlice(text.slice(cursor, range.start), bg, dimmed);

		out += paintMessageSlice(text.slice(range.start, range.end), THEME.match, dimmed);
		cursor = range.end;
	}

	if (cursor < text.length) out += paintMessageSlice(text.slice(cursor), bg, dimmed);

	return out;
}

export function paintSpan(
	span: RowSpan,
	level: LogLevel | null,
	style: PaintStyle,
	bg: Rgb | null = null,
	dimmed = false,
	filter: FilterSpec = EMPTY_FILTER,
): string {
	if (style === "plain") return span.text;

	if (span.role === "message") return paintMessage(span.text, bg, filter, dimmed);

	if (dimmed) return paintStyled(span.text, styleOn(fgOnly(THEME.subtle), bg));

	if (span.role === "timestamp" || span.role === "gutter") {
		return paintStyled(span.text, styleOn(fgOnly(THEME.muted), bg));
	}

	if (span.role === "pid") return paintStyled(span.text, styleOn(fgOnly(THEME.accent), bg));

	if (span.role === "level") return paintStyled(span.text, styleOn(levelStyle(level), bg));

	if (span.role === "tag") return paintStyled(span.text, styleOn(levelStyle(level), bg));

	if (span.role === "warning") return paintStyled(span.text, styleOn(fgOnly(THEME.amber), bg));

	if (span.text.trim().length === 0) return paintStyled(span.text, styleOn(fgOnly(THEME.text), bg));

	return highlightLogText(span.text, bg);
}

export function paintRow(
	row: ViewRow,
	style: PaintStyle,
	columns?: number,
	options: Readonly<{ dimmed?: boolean; filter?: FilterSpec }> = {},
): string {
	const width = columns === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, columns);
	const dimmed = options.dimmed === true;
	const filter = options.filter ?? EMPTY_FILTER;
	const bg = row.selected && row.kind === "header" ? THEME.selection : THEME.canvas;
	const marker = markerFor(row);
	const pieces: RowSpan[] = [{ text: marker, role: "gutter" }, ...row.spans];
	let used = 0;
	let out = "";

	if (style === "ansi" && bg) out += rgbSgr(bg, "bg");

	for (const piece of pieces) {
		const remaining = width - used;

		if (remaining <= 0) break;

		const clipped = clipToWidth(piece.text, remaining);

		if (style === "plain") out += clipped.text;
		else if (piece.role === "gutter" && piece.text === marker && row.selected && row.kind === "header" && !dimmed) {
			out += paintStyled(clipped.text, styleOn(fgBold(THEME.accent), bg));
		} else if (row.kind === "continuation") {
			const continuationStyle = piece.role === "gutter" ? fgOnly(THEME.subtle) : fgOnly(THEME.muted);
			out += paintStyled(clipped.text, styleOn(continuationStyle, bg));
		} else {
			out += paintSpan({ ...piece, text: clipped.text }, row.level, style, bg, dimmed, filter);
		}

		used += clipped.width;
	}

	if (used < width && width !== Number.MAX_SAFE_INTEGER) {
		const pad = " ".repeat(width - used);

		if (style === "ansi") out += paintStyled(pad, styleOn(fgOnly(dimmed ? THEME.subtle : THEME.text), bg));
		else out += pad;
	}

	if (style === "ansi") out += RESET;

	return out;
}

export function paintChrome(text: string, color: Rgb, style: PaintStyle, bg: Rgb | null = null): string {
	if (style === "plain") return text;

	return paintStyled(text, styleOn(fgOnly(color), bg));
}

export function paintFilled(text: string, columns: number, style: PaintStyle, fg: Rgb, bg: Rgb | null): string {
	const clipped = clipToWidth(text, columns);
	const pad = Math.max(0, columns - clipped.width);
	const body = `${clipped.text}${" ".repeat(pad)}`;

	if (style === "plain") return body;

	let out = "";

	if (bg) out += rgbSgr(bg, "bg");

	out += paintStyled(body, styleOn(fgOnly(fg), bg));
	out += RESET;

	return out;
}

export function lineWidth(text: string): number {
	return displayWidth(text);
}
