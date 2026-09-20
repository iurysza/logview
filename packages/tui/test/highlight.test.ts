import { describe, expect, test } from "bun:test";
import { fgCode, type Rgb } from "../src/catppuccin.ts";
import { highlightLogText } from "../src/highlight.ts";
import { THEME } from "../src/theme.ts";

function hasFg(text: string, color: Rgb): boolean {
	return text.includes(`\u001b[${fgCode(color)}m`);
}

describe("tailspin-style highlighting", () => {
	test("colors severity keywords, booleans, and numbers", () => {
		const painted = highlightLogText("ERROR Connection failed: null count=42");
		expect(hasFg(painted, THEME.red)).toBe(true);
		expect(hasFg(painted, THEME.cyan)).toBe(true);
		expect(painted).toContain("ERROR");
		expect(painted).toContain("null");
		expect(painted).toContain("42");
	});

	test("colors timestamps, urls, ipv4, uuids, and paths", () => {
		const painted = highlightLogText(
			"2022-09-22 08:11:00 POST https://example.com/api 192.168.0.1 /var/log/app.log 5f7d1bce-81ab-4a87-af78-9a37f26c58b1",
		);

		expect(hasFg(painted, THEME.purple)).toBe(true);
		expect(hasFg(painted, THEME.accent)).toBe(true);
		expect(hasFg(painted, THEME.green)).toBe(true);
		expect(hasFg(painted, THEME.amber)).toBe(true);
		expect(painted.includes("example.com")).toBe(true);
	});

	test("does not emit raw ESC from log text", () => {
		const painted = highlightLogText("stray ^[31m sequence");
		expect(painted.includes("\u001b[31m")).toBe(false);
		expect(painted).toContain("^[");
	});
});
