import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { Either, Schema } from "effect";
import { adbStubPath } from "../../../tests/support/adb-stubs/paths.ts";
import {
	SANITIZED_ADMITTED_EVENTS,
	SANITIZED_DEVICE_SERIAL,
} from "../../../tests/fixtures/real/sanitized-payload.ts";

const Summary = Schema.parseJson(
	Schema.Struct({
		version: Schema.Literal(1),
		kind: Schema.Literal("summary"),
		terminal: Schema.Struct({
			kind: Schema.String,
			error: Schema.optional(
				Schema.Struct({
					kind: Schema.String,
				}),
			),
		}),
		snapshot: Schema.Struct({
			stats: Schema.Struct({
				admittedEvents: Schema.Number,
				unparsedEvents: Schema.Number,
			}),
		}),
	}),
);

const repoRoot = join(import.meta.dir, "../../..");

async function runLogcayo(args: readonly string[]): Promise<{
	code: number;
	stdout: string;
	stderr: string;
}> {
	const bunDir = dirname(process.execPath);
	const path = `${bunDir}:${process.env.PATH ?? "/usr/bin:/bin"}`;

	const proc = Bun.spawn([process.execPath, join(repoRoot, "packages/cli/src/main.ts"), ...args], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			PATH: path,
			HOME: process.env.HOME ?? "",
		},
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;

	return { code, stdout, stderr };
}

describe("live ADB CLI smoke", () => {
	test("headless live against the one-device stub admits the sanitized fixture", async () => {
		const result = await runLogcayo([
			"live",
			"--headless",
			"--adb",
			adbStubPath("one-device"),
			"--serial",
			SANITIZED_DEVICE_SERIAL,
		]);

		expect(result.code).toBe(0);
		const line = result.stdout.trim().split("\n").at(-1) ?? "{}";
		const decoded = Schema.decodeEither(Summary)(line);

		Either.match(decoded, {
			onLeft: (error) => {
				throw new Error(`${error.message}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
			},
			onRight: (value) => {
				expect(value.terminal.kind).toBe("ended");
				expect(value.snapshot.stats.admittedEvents).toBe(SANITIZED_ADMITTED_EVENTS);
			},
		});
	});

	test("headless live with no device explains the failure", async () => {
		const result = await runLogcayo([
			"live",
			"--headless",
			"--adb",
			adbStubPath("no-device"),
		]);

		expect(result.code).toBe(1);
		expect(result.stdout.includes("no-device") || result.stderr.includes("no")).toBe(true);
	});

	test("headless live with a missing adb binary is a source failure", async () => {
		const result = await runLogcayo(["live", "--headless", "--adb", "/no/such/adb-binary"]);
		expect(result.code).toBe(1);

		const line = result.stdout.trim().split("\n").at(-1) ?? "{}";
		const decoded = Schema.decodeEither(Summary)(line);

		Either.match(decoded, {
			onLeft: (error) => {
				throw new Error(`${error.message}\nstdout=${result.stdout}`);
			},
			onRight: (value) => {
				expect(value.terminal.kind).toBe("failed");
				expect(value.terminal.error?.kind).toBe("adb-missing");
			},
		});
	});

	test("several devices without --serial refuse to pick one", async () => {
		const result = await runLogcayo(["live", "--headless", "--adb", adbStubPath("multi-device")]);
		expect(result.code).toBe(1);
		expect(result.stdout.includes("ambiguous-device")).toBe(true);
	});
});
