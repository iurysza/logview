import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function collectTs(root: string): Promise<string[]> {
	const out: string[] = [];
	const entries = await readdir(root, { withFileTypes: true });

	for (const entry of entries) {
		const path = join(root, entry.name);

		if (entry.isDirectory()) {
			if (entry.name === "test" || entry.name === "node_modules") continue;
			out.push(...(await collectTs(path)));
			continue;
		}

		if (entry.name.endsWith(".ts")) out.push(path);
	}

	return out;
}

function forbiddenImport(source: string, pattern: RegExp): boolean {
	return pattern.test(source);
}

describe("import boundaries", () => {
	test("core does not import engine, CLI, TUI, bun, or OpenTUI", async () => {
		const files = await collectTs("packages/core/src");

		for (const file of files) {
			const source = await readFile(file, "utf8");
			expect(forbiddenImport(source, fromSpecifier("@logview/engine"))).toBe(false);
			expect(forbiddenImport(source, fromSpecifier("@logview/tui"))).toBe(false);
			expect(forbiddenImport(source, fromSpecifier("@opentui/core"))).toBe(false);
			expect(forbiddenImport(source, fromSpecifier("bun"))).toBe(false);
		}
	});

	test("engine does not import TUI or OpenTUI", async () => {
		const files = await collectTs("packages/engine/src");

		for (const file of files) {
			const source = await readFile(file, "utf8");
			expect(forbiddenImport(source, fromSpecifier("@logview/tui"))).toBe(false);
			expect(forbiddenImport(source, fromSpecifier("@opentui/core"))).toBe(false);
		}
	});

	test("headless CLI modules do not import TUI or OpenTUI", async () => {
		for (const file of ["packages/cli/src/headless.ts", "packages/cli/src/record.ts"]) {
			const source = await readFile(file, "utf8");
			expect(source.includes("@logview/tui")).toBe(false);
			expect(source.includes("@opentui/core")).toBe(false);
		}
	});
});

function fromSpecifier(name: string): RegExp {
	return new RegExp(`from\\s+["']${name}["']`);
}
