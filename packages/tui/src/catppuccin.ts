export type Rgb = readonly [number, number, number];

export type MochaPalette = Readonly<{
	rosewater: Rgb;
	flamingo: Rgb;
	pink: Rgb;
	mauve: Rgb;
	red: Rgb;
	maroon: Rgb;
	peach: Rgb;
	yellow: Rgb;
	green: Rgb;
	teal: Rgb;
	sky: Rgb;
	sapphire: Rgb;
	blue: Rgb;
	lavender: Rgb;
	text: Rgb;
	subtext1: Rgb;
	subtext0: Rgb;
	overlay2: Rgb;
	overlay1: Rgb;
	overlay0: Rgb;
	surface2: Rgb;
	surface1: Rgb;
	surface0: Rgb;
	base: Rgb;
	mantle: Rgb;
	crust: Rgb;
}>;

/** Official Catppuccin Mocha. https://github.com/catppuccin/catppuccin */
export const MOCHA: MochaPalette = {
	rosewater: [245, 224, 220],
	flamingo: [242, 205, 205],
	pink: [245, 194, 231],
	mauve: [203, 166, 247],
	red: [243, 139, 168],
	maroon: [235, 160, 172],
	peach: [250, 179, 135],
	yellow: [249, 226, 175],
	green: [166, 227, 161],
	teal: [148, 226, 213],
	sky: [137, 220, 235],
	sapphire: [116, 199, 236],
	blue: [137, 180, 250],
	lavender: [180, 190, 254],
	text: [205, 214, 244],
	subtext1: [186, 194, 222],
	subtext0: [166, 173, 200],
	overlay2: [147, 153, 178],
	overlay1: [127, 132, 156],
	overlay0: [108, 112, 134],
	surface2: [88, 91, 112],
	surface1: [69, 71, 90],
	surface0: [49, 50, 68],
	base: [30, 30, 46],
	mantle: [24, 24, 37],
	crust: [17, 17, 27],
};

export type CellStyle = Readonly<{
	fg: Rgb;
	bg: Rgb | null;
	italic: boolean;
	bold: boolean;
}>;

export function fgOnly(fg: Rgb): CellStyle {
	return { fg, bg: null, italic: false, bold: false };
}

export function fgItalic(fg: Rgb): CellStyle {
	return { fg, bg: null, italic: true, bold: false };
}

export function fgBold(fg: Rgb): CellStyle {
	return { fg, bg: null, italic: false, bold: true };
}

export function fgOn(fg: Rgb, bg: Rgb): CellStyle {
	return { fg, bg, italic: false, bold: true };
}

export const RESET = "\u001b[0m";

export function rgbSgr(color: Rgb, kind: "fg" | "bg"): string {
	const channel = kind === "fg" ? "38" : "48";

	return `\u001b[${channel};2;${color[0]};${color[1]};${color[2]}m`;
}

export function paintStyled(text: string, style: CellStyle): string {
	if (text.length === 0) return "";

	let codes = rgbSgr(style.fg, "fg");

	if (style.bg) codes += rgbSgr(style.bg, "bg");

	if (style.italic) codes += "\u001b[3m";

	if (style.bold) codes += "\u001b[1m";

	return `${codes}${text}${RESET}`;
}

export function fgCode(color: Rgb): string {
	return `38;2;${color[0]};${color[1]};${color[2]}`;
}
