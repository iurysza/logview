import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function collectTsFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const entries = await readdir(root, { withFileTypes: true });

	for (const entry of entries) {
		const path = join(root, entry.name);

		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "test") continue;
			out.push(...(await collectTsFiles(path)));
			continue;
		}

		if (entry.name.endsWith(".ts")) out.push(path);
	}

	return out;
}

function importedSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const pattern = /from\s+["']([^"']+)["']/g;
	let match = pattern.exec(source);

	while (match) {
		specifiers.push(match[1]!);
		match = pattern.exec(source);
	}

	return specifiers;
}

describe("import boundaries", () => {
	test("core does not import Bun or OpenTUI", async () => {
		const files = await collectTsFiles(join(import.meta.dir, "../../packages/core/src"));

		for (const file of files) {
			const source = await readFile(file, "utf8");

			for (const specifier of importedSpecifiers(source)) {
				expect(specifier.includes("bun") || specifier.includes("opentui")).toBe(false);
			}
		}
	});

	test("engine does not import OpenTUI or the TUI package", async () => {
		const files = await collectTsFiles(join(import.meta.dir, "../../packages/engine/src"));

		for (const file of files) {
			const source = await readFile(file, "utf8");

			for (const specifier of importedSpecifiers(source)) {
				expect(specifier.includes("opentui") || specifier.includes("@logview/tui")).toBe(false);
			}
		}
	});

	test("headless CLI does not import the TUI package", async () => {
		const source = await readFile(join(import.meta.dir, "../../packages/cli/src/headless.ts"), "utf8");

		for (const specifier of importedSpecifiers(source)) {
			expect(specifier.includes("@logview/tui") || specifier.includes("opentui")).toBe(false);
		}
	});
});
