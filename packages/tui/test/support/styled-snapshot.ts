export type Rgb = Readonly<{ r: number; g: number; b: number }>;

export type CellAttributes = Readonly<{
	bold: boolean;
	italic: boolean;
	faint: boolean;
	invisible: boolean;
	strikethrough: boolean;
	overline: boolean;
	underline: "single" | null;
}>;

export type StyledCell = Readonly<{
	x: number;
	y: number;
	text: string;
	width: number;
	foreground: Rgb;
	background: Rgb;
	attributes: CellAttributes;
}>;

type SpanStyle = Readonly<{
	x: number;
	y: number;
	foreground: Rgb;
	background: Rgb;
	attributes: CellAttributes;
}>;

export type StyledSpan =
	| (SpanStyle &
			Readonly<{
				text: string;
				widths?: readonly number[];
			}>)
	| (SpanStyle &
			Readonly<{
				glyphs: readonly Readonly<{ text: string; width: number }>[];
			}>);

export type StyledSnapshot = Readonly<{
	cols: number;
	rows: number;
	foreground: Rgb;
	background: Rgb;
	spans: readonly StyledSpan[];
}>;

export type SnapshotChange =
	| Readonly<{
			kind: "size";
			property: "cols" | "rows";
			expected: string;
			actual: string;
	  }>
	| Readonly<{
			kind: "cell";
			row: number;
			column: number;
			property:
				| "text"
				| "width"
				| "foreground"
				| "background"
				| "bold"
				| "italic"
				| "faint"
				| "invisible"
				| "strikethrough"
				| "overline"
				| "underline"
				| "missing"
				| "extra";
			expected: string;
			actual: string;
	  }>;

export type SnapshotDiff = Readonly<{
	equal: boolean;
	changes: readonly SnapshotChange[];
}>;

type Frame = Readonly<{
	cols: number;
	rows: number;
	foreground: Rgb;
	background: Rgb;
	cells: readonly StyledCell[];
}>;

export function snapshotFromTerminalControl(text: string): StyledSnapshot {
	const frame = parseFrame(parseJson(text));

	return compactSnapshot(frame);
}

export function parseStyledSnapshot(text: string): StyledSnapshot {
	const value = parseJson(text);

	if (!isRecord(value)) throw new Error("styled snapshot must be an object");

	return {
		cols: positiveInteger(value.cols, "cols"),
		rows: positiveInteger(value.rows, "rows"),
		foreground: color(value.foreground, "foreground"),
		background: color(value.background, "background"),
		spans: array(value.spans, "spans").map((span, index) => parseSpan(span, index)),
	};
}

export function compactSnapshot(frame: Frame): StyledSnapshot {
	const grouped: StyledCell[][] = [];

	for (const cell of [...frame.cells].sort(compareCells)) {
		const cells = grouped.at(-1);
		const previous = cells?.at(-1);

		if (cells && previous && canExtend(cells[0]!, previous, cell)) {
			cells.push(cell);
		} else {
			grouped.push([cell]);
		}
	}

	return {
		cols: frame.cols,
		rows: frame.rows,
		foreground: frame.foreground,
		background: frame.background,
		spans: grouped.map(compactSpan),
	};
}

export function serializeSnapshot(snapshot: StyledSnapshot): string {
	return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function cellsFromSnapshot(snapshot: StyledSnapshot): StyledCell[] {
	const cells: StyledCell[] = [];

	for (const span of snapshot.spans) {
		let x = span.x;

		for (const glyph of glyphs(span)) {
			cells.push({
				x,
				y: span.y,
				text: glyph.text,
				width: glyph.width,
				foreground: span.foreground,
				background: span.background,
				attributes: span.attributes,
			});
			x += glyph.width;
		}
	}

	return cells;
}

export function diffSnapshots(expected: StyledSnapshot, actual: StyledSnapshot): SnapshotDiff {
	const changes: SnapshotChange[] = [];

	if (expected.cols !== actual.cols) {
		changes.push({ kind: "size", property: "cols", expected: String(expected.cols), actual: String(actual.cols) });
	}

	if (expected.rows !== actual.rows) {
		changes.push({ kind: "size", property: "rows", expected: String(expected.rows), actual: String(actual.rows) });
	}

	const actualCells = new Map(cellsFromSnapshot(actual).map((cell) => [position(cell), cell]));

	for (const expectedCell of cellsFromSnapshot(expected)) {
		const key = position(expectedCell);
		const actualCell = actualCells.get(key);

		if (!actualCell) {
			changes.push({
				kind: "cell",
				row: expectedCell.y,
				column: expectedCell.x,
				property: "missing",
				expected: describeCell(expectedCell),
				actual: "<absent>",
			});
			continue;
		}

		actualCells.delete(key);
		compareCell(changes, expectedCell, actualCell);
	}

	for (const extra of actualCells.values()) {
		changes.push({
			kind: "cell",
			row: extra.y,
			column: extra.x,
			property: "extra",
			expected: "<absent>",
			actual: describeCell(extra),
		});
	}

	return { equal: changes.length === 0, changes };
}

export function formatSnapshotDiff(diff: SnapshotDiff): string {
	if (diff.equal) return "styled cells match";

	return diff.changes
		.map((change) => {
			if (change.kind === "size") return `${change.property}: expected ${change.expected}; actual ${change.actual}`;

			return `row ${change.row} col ${change.column} ${change.property}: expected ${change.expected}; actual ${change.actual}`;
		})
		.join("\n");
}

export function textFromSnapshot(snapshot: StyledSnapshot): string {
	const rows = Array.from({ length: snapshot.rows }, () => Array.from({ length: snapshot.cols }, () => " "));

	for (const cell of cellsFromSnapshot(snapshot)) {
		if (cell.y >= snapshot.rows || cell.x >= snapshot.cols) continue;

		rows[cell.y]![cell.x] = cell.text;
		for (let offset = 1; offset < cell.width && cell.x + offset < snapshot.cols; offset += 1) {
			rows[cell.y]![cell.x + offset] = "";
		}
	}

	return `${rows.map((row) => row.join("")).join("\n")}\n`;
}

function compactSpan(cells: readonly StyledCell[]): StyledSpan {
	const first = cells[0]!;
	const text = cells.map((cell) => cell.text).join("");
	const codePoints = [...text];
	const base: SpanStyle = {
		x: first.x,
		y: first.y,
		foreground: first.foreground,
		background: first.background,
		attributes: first.attributes,
	};

	if (codePoints.length !== cells.length) {
		return { ...base, glyphs: cells.map((cell) => ({ text: cell.text, width: cell.width })) };
	}

	const widths = cells.map((cell) => cell.width);

	return widths.every((width) => width === 1) ? { ...base, text } : { ...base, text, widths };
}

function glyphs(span: StyledSpan): readonly Readonly<{ text: string; width: number }>[] {
	if ("glyphs" in span) return span.glyphs;

	const text = [...span.text];
	const widths = span.widths ?? text.map(() => 1);

	return text.map((character, index) => ({ text: character, width: widths[index]! }));
}

function parseFrame(value: unknown): Frame {
	if (!isRecord(value) || value.version !== 1) {
		throw new Error("Terminal Control JSON must be a version 1 frame");
	}

	return {
		cols: positiveInteger(value.cols, "cols"),
		rows: positiveInteger(value.rows, "rows"),
		foreground: color(value.foreground, "foreground"),
		background: color(value.background, "background"),
		cells: array(value.cells, "cells").map((cell, index) => parseCell(cell, `cells[${index}]`)),
	};
}

function parseSpan(value: unknown, index: number): StyledSpan {
	if (!isRecord(value)) throw new Error(`spans[${index}] must be an object`);

	const base: SpanStyle = {
		x: nonNegativeInteger(value.x, `spans[${index}].x`),
		y: nonNegativeInteger(value.y, `spans[${index}].y`),
		foreground: color(value.foreground, `spans[${index}].foreground`),
		background: color(value.background, `spans[${index}].background`),
		attributes: attributes(value.attributes, `spans[${index}].attributes`),
	};

	if (typeof value.text === "string") {
		const codePoints = [...value.text];
		const widths = value.widths === undefined ? undefined : array(value.widths, `spans[${index}].widths`).map((width, widthIndex) => positiveInteger(width, `spans[${index}].widths[${widthIndex}]`));

		if (codePoints.length === 0 || (widths && widths.length !== codePoints.length)) {
			throw new Error(`spans[${index}] has invalid text widths`);
		}

		return widths ? { ...base, text: value.text, widths } : { ...base, text: value.text };
	}

	const parsedGlyphs = array(value.glyphs, `spans[${index}].glyphs`).map((glyph, glyphIndex) => {
		if (!isRecord(glyph)) throw new Error(`spans[${index}].glyphs[${glyphIndex}] must be an object`);

		return {
			text: string(glyph.text, `spans[${index}].glyphs[${glyphIndex}].text`),
			width: positiveInteger(glyph.width, `spans[${index}].glyphs[${glyphIndex}].width`),
		};
	});

	if (parsedGlyphs.length === 0) throw new Error(`spans[${index}].glyphs must not be empty`);

	return { ...base, glyphs: parsedGlyphs };
}

function parseCell(value: unknown, name: string): StyledCell {
	if (!isRecord(value)) throw new Error(`${name} must be an object`);

	return {
		x: nonNegativeInteger(value.x, `${name}.x`),
		y: nonNegativeInteger(value.y, `${name}.y`),
		text: string(value.text, `${name}.text`),
		width: positiveInteger(value.width, `${name}.width`),
		foreground: color(value.foreground, `${name}.foreground`),
		background: color(value.background, `${name}.background`),
		attributes: attributes(value.attributes, `${name}.attributes`),
	};
}

function canExtend(first: StyledCell, previous: StyledCell, next: StyledCell): boolean {
	return (
		first.y === next.y &&
		previous.x + previous.width === next.x &&
		colorsEqual(first.foreground, next.foreground) &&
		colorsEqual(first.background, next.background) &&
		attributesEqual(first.attributes, next.attributes)
	);
}

function compareCells(left: StyledCell, right: StyledCell): number {
	return left.y === right.y ? left.x - right.x : left.y - right.y;
}

function compareCell(changes: SnapshotChange[], expected: StyledCell, actual: StyledCell): void {
	pushChange(changes, expected, "text", expected.text, actual.text);
	pushChange(changes, expected, "width", String(expected.width), String(actual.width));
	pushChange(changes, expected, "foreground", formatColor(expected.foreground), formatColor(actual.foreground));
	pushChange(changes, expected, "background", formatColor(expected.background), formatColor(actual.background));
	pushChange(changes, expected, "bold", String(expected.attributes.bold), String(actual.attributes.bold));
	pushChange(changes, expected, "italic", String(expected.attributes.italic), String(actual.attributes.italic));
	pushChange(changes, expected, "faint", String(expected.attributes.faint), String(actual.attributes.faint));
	pushChange(changes, expected, "invisible", String(expected.attributes.invisible), String(actual.attributes.invisible));
	pushChange(changes, expected, "strikethrough", String(expected.attributes.strikethrough), String(actual.attributes.strikethrough));
	pushChange(changes, expected, "overline", String(expected.attributes.overline), String(actual.attributes.overline));
	pushChange(changes, expected, "underline", formatUnderline(expected.attributes.underline), formatUnderline(actual.attributes.underline));
}

function pushChange(
	changes: SnapshotChange[],
	cell: StyledCell,
	property: Extract<SnapshotChange, { kind: "cell" }>["property"],
	expected: string,
	actual: string,
): void {
	if (expected !== actual) {
		changes.push({ kind: "cell", row: cell.y, column: cell.x, property, expected, actual });
	}
}

function color(value: unknown, name: string): Rgb {
	if (!isRecord(value)) throw new Error(`${name} must be an RGB object`);

	return { r: byte(value.r, `${name}.r`), g: byte(value.g, `${name}.g`), b: byte(value.b, `${name}.b`) };
}

function attributes(value: unknown, name: string): CellAttributes {
	if (!isRecord(value)) throw new Error(`${name} must be an object`);

	const underline = value.underline;
	if (underline !== null && underline !== "single") throw new Error(`${name}.underline must be \"single\" or null`);

	return {
		bold: boolean(value.bold, `${name}.bold`),
		italic: boolean(value.italic, `${name}.italic`),
		faint: boolean(value.faint, `${name}.faint`),
		invisible: boolean(value.invisible, `${name}.invisible`),
		strikethrough: boolean(value.strikethrough, `${name}.strikethrough`),
		overline: boolean(value.overline, `${name}.overline`),
		underline,
	};
}

function colorsEqual(left: Rgb, right: Rgb): boolean {
	return left.r === right.r && left.g === right.g && left.b === right.b;
}

function attributesEqual(left: CellAttributes, right: CellAttributes): boolean {
	return (
		left.bold === right.bold &&
		left.italic === right.italic &&
		left.faint === right.faint &&
		left.invisible === right.invisible &&
		left.strikethrough === right.strikethrough &&
		left.overline === right.overline &&
		left.underline === right.underline
	);
}

function position(cell: StyledCell): string {
	return `${cell.y}:${cell.x}`;
}

function describeCell(cell: StyledCell): string {
	return `${JSON.stringify(cell.text)} width=${cell.width} foreground=${formatColor(cell.foreground)} background=${formatColor(cell.background)}`;
}

function formatColor(color: Rgb): string {
	return `rgb(${color.r},${color.g},${color.b})`;
}

function formatUnderline(underline: CellAttributes["underline"]): string {
	return underline ?? "none";
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new Error(`invalid JSON: ${errorMessage(cause)}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function array(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`);

	return value;
}

function string(value: unknown, name: string): string {
	if (typeof value !== "string") throw new Error(`${name} must be a string`);

	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);

	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive safe integer`);
	}

	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative safe integer`);
	}

	return value;
}

function byte(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
		throw new Error(`${name} must be an integer from 0 to 255`);
	}

	return value;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : "unknown error";
}
