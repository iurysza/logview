import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { sanitizedRecordingPath } from "../../../tests/fixtures/real/build-recording.ts";

const repoRoot = join(import.meta.dir, "../../..");

const driver = join(import.meta.dir, "pty-driver.py");

describe("tui pty smoke", () => {
	test("replay on a real PTY paints chrome, accepts keys, and restores the terminal", async () => {
		const recording = sanitizedRecordingPath();
		const bunDir = dirname(process.execPath);
		const cli = join(repoRoot, "packages/cli/src/main.ts");

		const proc = Bun.spawn(
			["python3", driver, process.execPath, cli, "replay", recording, "--speed", "instant"],
			{
				cwd: repoRoot,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					PATH: `${bunDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
					TERM: "xterm-256color",
				},
			},
		);

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const code = await proc.exited;

		expect(code).toBe(0);
		expect(stdout.includes("logview")).toBe(true);
		expect(stdout.includes("q Quit") || stdout.includes("REPLAY")).toBe(true);
		expect(stdout.includes("日本語")).toBe(true);
		expect(stdout.includes("t filter tag")).toBe(true);
		expect(stdout.includes("\u001b[31m")).toBe(false);
		expect(stdout.includes("\n.M") || stdout.includes("\r.M")).toBe(false);
		expect(stderr).not.toContain("Traceback");
	}, 20_000);
});
