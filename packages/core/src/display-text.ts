const CJK_RANGES: readonly [number, number][] = [
	[0x1100, 0x115f],
	[0x2329, 0x232a],
	[0x2e80, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe10, 0xfe19],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x1f300, 0x1f64f],
	[0x1f900, 0x1f9ff],
	[0x1fa70, 0x1faff],
	[0x20000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
	for (const [start, end] of CJK_RANGES) {
		if (codePoint >= start && codePoint <= end) return true;
	}
	return false;
}

function isCombining(codePoint: number): boolean {
	return (
		(codePoint >= 0x0300 && codePoint <= 0x036f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f)
	);
}

export type EscapedUnit = Readonly<{
	source: string;
	display: string;
	width: number;
}>;

export function escapeCodePoint(codePoint: number): EscapedUnit {
	if (codePoint === 0x09) {
		return { source: "\t", display: "^I", width: 2 };
	}
	if (codePoint === 0x1b) {
		return { source: "\u001b", display: "^[", width: 2 };
	}
	if (codePoint < 0x20 || codePoint === 0x7f) {
		const caret = codePoint === 0x7f ? "?" : String.fromCharCode(codePoint + 64);
		return {
			source: String.fromCodePoint(codePoint),
			display: `^${caret}`,
			width: 2,
		};
	}
	if (codePoint >= 0x80 && codePoint <= 0x9f) {
		return {
			source: String.fromCodePoint(codePoint),
			display: `\\u${codePoint.toString(16).padStart(4, "0")}`,
			width: 6,
		};
	}
	const source = String.fromCodePoint(codePoint);
	if (isCombining(codePoint)) {
		return { source, display: source, width: 0 };
	}
	return { source, display: source, width: isWide(codePoint) ? 2 : 1 };
}

export function escapeDisplayText(text: string): EscapedUnit[] {
	const units: EscapedUnit[] = [];
	for (const char of text) {
		units.push(escapeCodePoint(char.codePointAt(0)!));
	}
	return units;
}

export function displayWidth(text: string): number {
	let width = 0;
	for (const unit of escapeDisplayText(text)) width += unit.width;
	return width;
}

export function clipToWidth(text: string, width: number): { text: string; clipped: boolean } {
	if (width <= 0) return { text: "", clipped: displayWidth(text) > 0 };
	const units = escapeDisplayText(text);
	let used = 0;
	let out = "";
	for (const unit of units) {
		if (used + unit.width > width) {
			if (width >= 1 && used < width) {
				out += "…";
			} else if (width >= 1) {
				out = `${out.slice(0, Math.max(0, out.length - 1))}…`;
			}
			return { text: out, clipped: true };
		}
		out += unit.display;
		used += unit.width;
	}
	return { text: out, clipped: false };
}

export function containsControlBytes(text: string): boolean {
	for (const char of text) {
		const cp = char.codePointAt(0)!;
		if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return true;
	}
	return false;
}
