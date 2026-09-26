import { displayWidth, escapeDisplayText } from "@logcayo/core";
import type { CellStyle } from "./catppuccin.ts";
import type { ChromeLine, ChromeSpan } from "./chrome.ts";

const BREAK_AFTER = new Set([",", ";", "=", ")", "/", ".", ":"]);

type Cut = Readonly<{
	keep: number;
	next: number;
}>;

type StyledUnit = Readonly<{
	display: string;
	width: number;
	style: CellStyle;
}>;

function measure(units: readonly StyledUnit[]): number {
	let width = 0;

	for (const unit of units) width += unit.width;

	return width;
}

function spansWidth(spans: ChromeLine): number {
	let text = "";

	for (const span of spans) text += span.text;

	return displayWidth(text);
}

function contentBudget(width: number, prefix: ChromeLine): number {
	const budget = width - spansWidth(prefix);

	return budget > 0 ? budget : 1;
}

function unitsFromSpans(spans: ChromeLine): StyledUnit[] {
	const owners: CellStyle[] = [];
	let text = "";

	for (const span of spans) {
		text += span.text;

		for (let index = 0; index < span.text.length; index += 1) owners.push(span.style);
	}

	const units: StyledUnit[] = [];
	let offset = 0;

	for (const unit of escapeDisplayText(text)) {
		const style = owners[offset] ?? owners[owners.length - 1];

		if (style) units.push({ display: unit.display, width: unit.width, style });
		offset += unit.source.length;
	}

	return units;
}

function isBreakSpace(unit: StyledUnit): boolean {
	return unit.display === " " && unit.width === 1;
}

function fitCount(units: readonly StyledUnit[], limit: number): number {
	let used = 0;
	let count = 0;

	for (const unit of units) {
		if (used + unit.width > limit) break;
		used += unit.width;
		count += 1;
	}

	return count;
}

function lastContentSpace(units: readonly StyledUnit[], fitted: number): number {
	let space = -1;

	for (let index = 0; index < fitted; index += 1) {
		if (isBreakSpace(units[index]!) && index > 0) space = index;
	}

	return space;
}

function tokenWidth(units: readonly StyledUnit[], start: number): number {
	let width = 0;

	for (let index = start; index < units.length; index += 1) {
		if (isBreakSpace(units[index]!)) break;
		width += units[index]!.width;
	}

	return width;
}

function groupWidth(units: readonly StyledUnit[], start: number): number {
	let width = 0;

	for (let index = start; index < units.length; index += 1) {
		width += units[index]!.width;

		if (units[index]!.display === ")") return width;
	}

	return width;
}

function cutBeforeParen(units: readonly StyledUnit[], fitted: number, limit: number): Cut | null {
	let best: Cut | null = null;
	let used = 0;

	for (let index = 0; index < fitted; index += 1) {
		const unit = units[index]!;

		if (unit.display === "(" && index > 0 && used + groupWidth(units, index) > limit) {
			best = { keep: index, next: index };
		}

		used += unit.width;
	}

	return best;
}

function cutAfterPunctuation(units: readonly StyledUnit[], fitted: number): Cut | null {
	let best = -1;

	for (let index = 0; index < fitted; index += 1) {
		if (BREAK_AFTER.has(units[index]!.display)) best = index;
	}

	if (best < 0) return null;

	return { keep: best + 1, next: best + 1 };
}

function chooseCut(units: readonly StyledUnit[], limit: number): Cut {
	const fitted = fitCount(units, limit);

	if (fitted === 0) return { keep: 1, next: 1 };

	const space = lastContentSpace(units, fitted);

	if (space > 0 && tokenWidth(units, space + 1) <= limit) {
		return { keep: space, next: space + 1 };
	}

	const paren = cutBeforeParen(units, fitted, limit);

	if (paren) return paren;

	const punct = cutAfterPunctuation(units, fitted);

	if (punct) return punct;

	return { keep: fitted, next: fitted };
}

function splitUnits(
	units: readonly StyledUnit[],
	firstBudget: number,
	restBudget: number,
): (readonly StyledUnit[])[] {
	const rows: (readonly StyledUnit[])[] = [];
	let rest = units;
	let budget = firstBudget;

	while (rest.length > 0) {
		if (measure(rest) <= budget) {
			rows.push(rest);
			break;
		}

		const cut = chooseCut(rest, budget);
		const keep = cut.keep > 0 ? cut.keep : 1;
		const next = cut.next >= keep ? cut.next : keep;

		rows.push(rest.slice(0, keep));
		rest = rest.slice(next);
		budget = restBudget;

		while (rest.length > 0 && isBreakSpace(rest[0]!)) rest = rest.slice(1);
	}

	if (rows.length === 0) rows.push([]);

	return rows;
}

function spansFromUnits(units: readonly StyledUnit[]): ChromeSpan[] {
	const spans: ChromeSpan[] = [];

	for (const unit of units) {
		const last = spans[spans.length - 1];

		if (last && last.style === unit.style) {
			spans[spans.length - 1] = { text: last.text + unit.display, style: last.style };
			continue;
		}

		spans.push({ text: unit.display, style: unit.style });
	}

	return spans;
}

/** Wraps styled spans on display units. `width` includes the row prefixes. */
export function wrapChromeLine(
	spans: ChromeLine,
	width: number,
	firstPrefix: ChromeLine = [],
	restPrefix: ChromeLine = [],
): ChromeLine[] {
	const rows = splitUnits(unitsFromSpans(spans), contentBudget(width, firstPrefix), contentBudget(width, restPrefix));

	return rows.map((row, index) => {
		const prefix = index === 0 ? firstPrefix : restPrefix;

		return [...prefix, ...spansFromUnits(row)];
	});
}
