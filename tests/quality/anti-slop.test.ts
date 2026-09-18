import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("anti-slop quality gate", () => {
	test("oxlint reports anti-slop violations on a known-slop fixture", () => {
		const fixture = join(import.meta.dir, "../../tools/oxlint/fixtures/slop-example.ts");

		const proc = Bun.spawnSync(["bun", "--bun", "oxlint", "-c", "oxlint.config.ts", fixture], {
			cwd: join(import.meta.dir, "../.."),
			stdout: "pipe",
			stderr: "pipe",
		});

		const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;
		expect(proc.exitCode).not.toBe(0);
		expect(output.includes("anti-slop")).toBe(true);
	});
});
