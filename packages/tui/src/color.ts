import { clipToWidth, displayWidth, markerFor, type LogLevel, type RowSpan, type ViewRow } from "@logview/core";
import { fgBold, fgOnly, MOCHA, paintStyled, RESET, rgbSgr, styleOn, type Rgb } from "./catppuccin.ts";
import { highlightLogText } from "./highlight.ts";

export type PaintStyle = "plain" | "ansi";

export function paintStyleFromEnv(noColor: string | undefined, forceColor: string | undefined): PaintStyle {
	if (noColor !== undefined && noColor.length > 0) return "plain";

	if (forceColor === "0") return "plain";

	return "ansi";
}

function levelStyle(level: LogLevel | null) {
	if (level === "V") return fgOnly(MOCHA.overlay2);

	if (level === "D") return fgOnly(MOCHA.overlay1);

	if (level === "I") return fgOnly(MOCHA.subtext0);

	if (level === "W") return fgOnly(MOCHA.yellow);

	if (level === "E") return fgBold(MOCHA.red);

	if (level === "F") return fgBold(MOCHA.maroon);

	return fgOnly(MOCHA.overlay2);
}

export function paintSpan(
	span: RowSpan,
	level: LogLevel | null,
	style: PaintStyle,
	bg: Rgb | null = null,
	dimmed = false,
): string {
	if (style === "plain") return span.text;

	if (dimmed) return paintStyled(span.text, styleOn(fgOnly(MOCHA.overlay0), bg));

	if (span.role === "timestamp" || span.role === "pid" || span.role === "gutter") {
		return paintStyled(span.text, styleOn(fgOnly(MOCHA.overlay1), bg));
	}

	if (span.role === "level") return paintStyled(span.text, styleOn(levelStyle(level), bg));

	if (span.role === "tag") return paintStyled(span.text, styleOn(fgOnly(MOCHA.overlay2), bg));

	if (span.role === "warning") return paintStyled(span.text, styleOn(fgOnly(MOCHA.yellow), bg));

	if (span.text.trim().length === 0) return paintStyled(span.text, styleOn(fgOnly(MOCHA.text), bg));

	return highlightLogText(span.text, bg);
}

export function paintRow(
	row: ViewRow,
	style: PaintStyle,
	columns?: number,
	options: Readonly<{ dimmed?: boolean }> = {},
): string {
	const width = columns === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, columns);
	const dimmed = options.dimmed === true;
	const bg = row.selected ? MOCHA.surface0 : null;
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
			out += paintStyled(clipped.text, styleOn(fgBold(MOCHA.lavender), bg));
		} else {
			out += paintSpan({ ...piece, text: clipped.text }, row.level, style, bg, dimmed);
		}

		used += clipped.width;
	}

	if (used < width && width !== Number.MAX_SAFE_INTEGER) {
		const pad = " ".repeat(width - used);

		if (style === "ansi" && bg) {
			out += paintStyled(pad, styleOn(fgOnly(dimmed ? MOCHA.overlay0 : MOCHA.text), bg));
		} else {
			out += pad;
		}
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
