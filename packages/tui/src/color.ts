import type { LogLevel, RowSpan, ViewRow } from "@logview/core";
import { fgBold, fgOnly, MOCHA, paintStyled, rgbSgr, RESET } from "./catppuccin.ts";
import { highlightLogText } from "./highlight.ts";

export type PaintStyle = "plain" | "ansi";

export function paintStyleFromEnv(noColor: string | undefined, forceColor: string | undefined): PaintStyle {
	if (noColor !== undefined && noColor.length > 0) return "plain";

	if (forceColor === "0") return "plain";

	return "ansi";
}

export function screenPrelude(): string {
	return `${rgbSgr(MOCHA.base, "bg")}${rgbSgr(MOCHA.text, "fg")}`;
}

function levelStyle(level: LogLevel | null) {
	if (level === "V") return fgOnly(MOCHA.overlay2);

	if (level === "D") return fgOnly(MOCHA.green);

	if (level === "I") return fgOnly(MOCHA.teal);

	if (level === "W") return fgOnly(MOCHA.yellow);

	if (level === "E") return fgOnly(MOCHA.red);

	if (level === "F") return fgBold(MOCHA.maroon);

	return fgOnly(MOCHA.overlay2);
}

function paintTimestamp(text: string): string {
	let out = "";

	for (const char of text) {
		if (char === ":" || char === ".") out += paintStyled(char, fgOnly(MOCHA.overlay0));
		else out += paintStyled(char, fgOnly(MOCHA.blue));
	}

	return out;
}

export function paintSpan(span: RowSpan, level: LogLevel | null, style: PaintStyle): string {
	if (style === "plain") return span.text;

	if (span.role === "timestamp") return paintTimestamp(span.text);

	if (span.role === "level") return paintStyled(span.text, levelStyle(level));

	if (span.role === "tag") return paintStyled(span.text, fgOnly(MOCHA.green));

	if (span.role === "warning") return paintStyled(span.text, fgOnly(MOCHA.yellow));

	if (span.text.trim().length === 0) return paintStyled(span.text, fgOnly(MOCHA.text));

	return highlightLogText(span.text);
}

export function paintRow(row: ViewRow, style: PaintStyle): string {
	const marker = row.selected ? "›" : " ";

	if (style === "plain") {
		let plain = marker;

		for (const span of row.spans) plain += span.text;

		return plain;
	}

	const rowBg = row.selected ? MOCHA.surface1 : MOCHA.base;
	const prefix = `${rgbSgr(rowBg, "bg")}${rgbSgr(MOCHA.text, "fg")}`;
	const paintedMarker = row.selected ? paintStyled(marker, fgBold(MOCHA.lavender)) : paintStyled(marker, fgOnly(MOCHA.overlay0));
	let out = `${prefix}${paintedMarker}`;

	for (const span of row.spans) out += paintSpan(span, row.level, style);

	return `${out}${RESET}${rgbSgr(MOCHA.base, "bg")}`;
}

export function paintChrome(text: string, color: typeof MOCHA.green, style: PaintStyle): string {
	if (style === "plain") return text;

	return paintStyled(text, fgOnly(color));
}
