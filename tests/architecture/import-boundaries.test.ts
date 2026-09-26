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
				expect(specifier.includes("opentui") || specifier.includes("@logcayo/tui")).toBe(false);
			}
		}
	});

	test("headless CLI does not import the TUI package", async () => {
		const source = await readFile(join(import.meta.dir, "../../packages/cli/src/headless.ts"), "utf8");

		for (const specifier of importedSpecifiers(source)) {
			expect(specifier.includes("@logcayo/tui") || specifier.includes("opentui")).toBe(false);
		}
	});

	test("CLI loads the TUI only through one dynamic import in main.ts", async () => {
		const files = await collectTsFiles(join(import.meta.dir, "../../packages/cli/src"));
		let dynamicImports = 0;

		for (const file of files) {
			const source = await readFile(file, "utf8");

			for (const specifier of importedSpecifiers(source)) {
				expect({ file, specifier, tui: specifier.includes("@logcayo/tui") || specifier.includes("opentui") }).toMatchObject({ tui: false });
			}

			const dynamic = source.match(/import\(\s*["']@logcayo\/tui["']\s*\)/g) ?? [];

			if (dynamic.length > 0) expect(file.endsWith("packages/cli/src/main.ts")).toBe(true);
			dynamicImports += dynamic.length;
		}

		expect(dynamicImports).toBe(1);
	});

	test("no package imports the CLI", async () => {
		for (const pkg of ["core", "engine", "tui"]) {
			const files = await collectTsFiles(join(import.meta.dir, `../../packages/${pkg}/src`));

			for (const file of files) {
				const source = await readFile(file, "utf8");

				for (const specifier of importedSpecifiers(source)) {
					expect({ file, specifier, cli: specifier.includes("@logcayo/cli") }).toMatchObject({ cli: false });
				}
			}
		}
	});

	test("packages import each other only through entry points", async () => {
		for (const pkg of ["core", "engine", "cli", "tui"]) {
			const files = await collectTsFiles(join(import.meta.dir, `../../packages/${pkg}/src`));

			for (const file of files) {
				const source = await readFile(file, "utf8");

				for (const specifier of importedSpecifiers(source)) {
					const deep = /^@logcayo\/[a-z]+\//.test(specifier) || /(\.\.\/)+(core|engine|cli|tui)\//.test(specifier);
					expect({ file, specifier, deep }).toMatchObject({ deep: false });
				}
			}
		}
	});

	test("filter text is parsed and matched only in core", async () => {
		const lowLevel = /\b(parseLevelField|parsePidField|foldText)\b/;

		for (const pkg of ["engine", "cli", "tui"]) {
			const files = await collectTsFiles(join(import.meta.dir, `../../packages/${pkg}/src`));

			for (const file of files) {
				const source = await readFile(file, "utf8");
				expect({ file, usesLowLevelParser: lowLevel.test(source) }).toMatchObject({ usesLowLevelParser: false });
			}
		}
	});

	test("the CLI parses filter text only through parseFilterQuery", async () => {
		const files = await collectTsFiles(join(import.meta.dir, "../../packages/cli/src"));

		for (const file of files) {
			const source = await readFile(file, "utf8");
			const buildsSpecByHand = /minLevel\s*:\s*(?!null)[^,}\n]+/.test(source) || /\bprepareFilter\(/.test(source);
			expect({ file, buildsSpecByHand }).toMatchObject({ buildsSpecByHand: false });
		}
	});

	test("core does not import the TypeSafe SDK", async () => {
		const files = await collectTsFiles(join(import.meta.dir, "../../packages/core/src"));

		for (const file of files) {
			const source = await readFile(file, "utf8");

			for (const specifier of importedSpecifiers(source)) {
				expect(specifier.includes("@typesafe-ai")).toBe(false);
			}
		}
	});
});
