import type { LogLevel } from "@logview/core";
import { fgBold, fgOnly, type CellStyle, type Rgb } from "./catppuccin.ts";

export type ThemeToken =
	| "canvas"
	| "bar"
	| "chip"
	| "selection"
	| "text"
	| "muted"
	| "subtle"
	| "accent"
	| "green"
	| "amber"
	| "red"
	| "cyan"
	| "purple";

export const THEME: Readonly<Record<ThemeToken, Rgb>> = {
	canvas: [17, 24, 32],
	bar: [29, 38, 51],
	chip: [39, 52, 71],
	selection: [28, 46, 74],
	text: [195, 205, 232],
	muted: [135, 150, 181],
	subtle: [82, 98, 127],
	accent: [69, 150, 255],
	green: [126, 231, 135],
	amber: [244, 201, 93],
	red: [255, 103, 120],
	cyan: [53, 212, 234],
	purple: [199, 146, 234],
};

export function severityStyle(level: LogLevel | null): CellStyle {
	if (level === "D" || level === "I") return fgOnly(THEME.green);

	if (level === "W") return fgOnly(THEME.amber);

	if (level === "E" || level === "F") return fgBold(THEME.red);

	return fgOnly(THEME.muted);
}
