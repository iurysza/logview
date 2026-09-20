import { describe, expect, test } from "bun:test";
import { CHROME_ROWS, logViewportHeight, MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from "@logview/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("headless quality gates", () => {
	test("an 8-row terminal reserves padded footer rows", () => {
		expect(CHROME_ROWS).toBe(6);
		expect(logViewportHeight(8)).toBe(2);
		expect(MIN_TERMINAL_COLUMNS).toBe(40);
		expect(MIN_TERMINAL_ROWS).toBe(8);
	});

	test("engine source does not import OpenTUI", async () => {
		const session = await readFile(join(import.meta.dir, "../../packages/engine/src/session.ts"), "utf8");
		expect(session.includes("@opentui")).toBe(false);
		expect(session.includes("@logview/tui")).toBe(false);
	});
});
