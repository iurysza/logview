import { describe, expect, test } from "bun:test";
import { displayWidth } from "@logcayo/core";
import type { ChromeLine, ChromeSpan } from "../src/chrome.ts";
import { THEME } from "../src/theme.ts";
import { wrapChromeLine } from "../src/wrap.ts";

function span(text: string, color = THEME.text): ChromeSpan {
	return { text, style: { fg: color, bg: null, bold: false, italic: false } };
}

function rowText(row: ChromeLine): string {
	let text = "";

	for (const piece of row) text += piece.text;

	return text;
}

function wrapped(text: string, width: number, first: ChromeLine = [], rest: ChromeLine = []): string[] {
	return wrapChromeLine([span(text)], width, first, rest).map(rowText);
}

describe("wrapChromeLine", () => {
	test("breaks after a space and drops it from the next row", () => {
		const rows = wrapped("alpha beta", 8);

		expect(rows).toEqual(["alpha", "beta"]);
		expect(rows.every((row) => !row.startsWith(" "))).toBe(true);
	});

	test("breaks a spaceless line after punctuation", () => {
		expect(wrapped("aaaa,bbbb,cccc", 6)).toEqual(["aaaa,", "bbbb,", "cccc"]);
	});

	test("hard-breaks a token that has no space or punctuation", () => {
		const rows = wrapped("abcdefghij", 4);

		expect(rows).toEqual(["abcd", "efgh", "ij"]);

		for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(4);
	});

	test("keeps a parenthetical location whole when the method is too long", () => {
		const method = "at com.example.logview.demo.db.Store.lock";
		const location = "(Store.java:88)";
		const gutter = [span("│  ", THEME.subtle)];

		const rows = wrapChromeLine(
			[span(method, THEME.text), span(location, THEME.cyan)],
			48,
			gutter,
			gutter,
		);

		const locationRow = rows.find((row) => rowText(row).includes("Store.java:88)"));

		expect(locationRow).toBeDefined();
		expect(rowText(locationRow!)).toBe(`│  ${location}`);
		expect(locationRow!.some((piece) => piece.text === location && piece.style.fg === THEME.cyan)).toBe(true);
		expect(rows[0]!.some((piece) => piece.text.startsWith("at ") && piece.style.fg === THEME.text)).toBe(true);

		for (const row of rows) expect(displayWidth(rowText(row))).toBeLessThanOrEqual(48);
	});

	test("keeps a style on both sides of a hard break", () => {
		const rows = wrapChromeLine([span("abcdefghij", THEME.red)], 4);

		expect(rows.flatMap((row) => row.map((piece) => piece.text)).join("")).toBe("abcdefghij");
		expect(rows.every((row) => row.every((piece) => piece.style.fg === THEME.red))).toBe(true);
	});

	test("uses the continuation prefix after the first row", () => {
		const rows = wrapChromeLine([span("abcdefghijklmnop")], 10, [span("├─ ")], [span("│  ")]);

		expect(rows[0]!.map((piece) => piece.text).join("").startsWith("├─ ")).toBe(true);
		expect(rows[1]!.map((piece) => piece.text).join("").startsWith("│  ")).toBe(true);

		for (const row of rows) expect(displayWidth(rowText(row))).toBeLessThanOrEqual(10);
	});

	test("counts wide characters and escapes as display units", () => {
		expect(wrapped("你好世界", 5)).toEqual(["你好", "世界"]);
		expect(wrapped("\u001bAB", 2)).toEqual(["^[", "AB"]);
		expect(displayWidth(wrapped("\tZ", 10)[0]!)).toBe(5);
		expect(wrapped("\tZ", 10)[0]!.startsWith("    ")).toBe(true);
	});

	test("keeps space-separated tokens whole", () => {
		const scan =
			"onScanResult to scannerId: 6- eventType=0x1b, addressType=1, address=XX:XX:XX:XX:46:90, primaryPhy=1, secondaryPhy=0, advertisingSid=0xff, txPower=127, rssi=-52, periodicAdvInt=0x0";

		const rows = wrapped(scan, 48);

		for (const token of scan.split(" ")) {
			expect(rows.some((row) => row.includes(token))).toBe(true);
		}

		expect(rows.every((row) => !row.startsWith(" ") && displayWidth(row) <= 48)).toBe(true);
	});
});
