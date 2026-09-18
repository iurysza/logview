import { describe, expect, test } from "bun:test";
import { fgCode, MOCHA } from "../src/catppuccin.ts";
import { highlightLogText } from "../src/highlight.ts";

function hasFg(text: string, color: typeof MOCHA.red): boolean {
	return text.includes(`\u001b[${fgCode(color)}m`);
}

describe("tailspin-style highlighting", () => {
	test("colors severity keywords, booleans, and numbers", () => {
		const painted = highlightLogText("ERROR Connection failed: null count=42");
		expect(hasFg(painted, MOCHA.red)).toBe(true);
		expect(hasFg(painted, MOCHA.maroon)).toBe(true);
		expect(hasFg(painted, MOCHA.teal)).toBe(true);
		expect(painted).toContain("ERROR");
		expect(painted).toContain("null");
		expect(painted).toContain("42");
	});

	test("colors timestamps, urls, ipv4, uuids, and paths", () => {
		const painted = highlightLogText(
			"2022-09-22 08:11:00 POST https://example.com/api 192.168.0.1 /var/log/app.log 5f7d1bce-81ab-4a87-af78-9a37f26c58b1",
		);

		expect(hasFg(painted, MOCHA.mauve)).toBe(true);
		expect(hasFg(painted, MOCHA.blue)).toBe(true);
		expect(hasFg(painted, MOCHA.green)).toBe(true);
		expect(hasFg(painted, MOCHA.yellow)).toBe(true);
		expect(painted.includes("example.com")).toBe(true);
	});

	test("does not emit raw ESC from log text", () => {
		const painted = highlightLogText("stray ^[31m sequence");
		expect(painted.includes("\u001b[31m")).toBe(false);
		expect(painted).toContain("^[");
	});
});
