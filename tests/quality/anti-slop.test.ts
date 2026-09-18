import { describe, expect, test } from "bun:test";

describe("anti-slop quality gate", () => {
	test("oxlint config registers anti-slop and Effect plugins", async () => {
		const config = await Bun.file("oxlint.config.ts").text();
		expect(config).toContain('name: "anti-slop"');
		expect(config).toContain("./tools/oxlint/anti-slop/index.ts");
		expect(config).toContain('name: "anti-slop-effect"');
		expect(config).toContain("./tools/oxlint/anti-slop/effect/index.ts");
		expect(config).toContain("anti-slop/no-unknown-parameters");
		expect(config).toContain("anti-slop-effect/prefer-effect-match");
	});

	test("engine depends on Effect as the implementation substrate", async () => {
		const pkg = await Bun.file("packages/engine/package.json").json();
		expect(pkg.dependencies.effect).toBe("3.22.2");
	});
});
