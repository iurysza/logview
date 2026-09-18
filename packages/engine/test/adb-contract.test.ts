import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@logview/core";
import {
	createAdbSource,
	createProcessRunner,
	createScheduler,
	LOGCAT_ARGS,
	type ChildProcessHandle,
	type ProcessRunner,
	type ProcessSpec,
	type SourceError,
} from "@logview/engine";
import { adbStubPath } from "../../../tests/support/adb-stubs/paths.ts";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";
import { SANITIZED_DEVICE_SERIAL } from "../../../tests/fixtures/real/sanitized-payload.ts";

class ScriptedProcessRunner implements ProcessRunner {
	constructor(
		private readonly devices: string,
		private readonly logLines: string[],
		private readonly stderrText = "",
	) {}

	spawn(spec: ProcessSpec): Result<ChildProcessHandle, SourceError> {
		if (spec.args[0] === "devices") {
			return ok(textHandle(this.devices, ""));
		}

		if (spec.args.includes("logcat")) {
			expect(spec.args.slice(spec.args.indexOf("logcat"))).toEqual([...LOGCAT_ARGS]);

			return ok(textHandle(this.logLines.join(""), this.stderrText));
		}

		return err({ kind: "io", message: `unexpected spawn ${spec.file} ${spec.args.join(" ")}` });
	}
}

function textHandle(stdout: string, stderr: string): ChildProcessHandle {
	return {
		stdout: once(stdout),
		stderr: once(stderr),
		exit: Promise.resolve({ code: 0, signal: null }),
		terminate: async () => undefined,
	};
}

async function* once(text: string): AsyncIterable<Uint8Array> {
	if (text.length > 0) yield new TextEncoder().encode(text);
}

async function collectKinds(
	source: ReturnType<typeof createAdbSource>,
): Promise<Array<{ kind: string; errorKind?: string }>> {
	const events: Array<{ kind: string; errorKind?: string }> = [];

	for await (const event of source.open(new AbortController().signal)) {
		if (event.kind === "failed") {
			events.push({ kind: event.kind, errorKind: event.error.kind });
			continue;
		}

		events.push({ kind: event.kind });
	}

	return events;
}

describe("adb source contract", () => {
	test("emits packets from a controlled subprocess then ends", async () => {
		const scheduler = new ManualScheduler();

		const source = createAdbSource(
			{ adbPath: "adb", serial: "ABC" },
			{
				processes: new ScriptedProcessRunner("List of devices attached\nABC\tdevice\n", [
					"1760000000.000001  1234  1250 I Tag: hello\n",
				]),
				scheduler,
			},
		);

		const events = await collectKinds(source);
		expect(events[0]?.kind).toBe("ready");
		expect(events.some((event) => event.kind === "chunk")).toBe(true);
		expect(events.at(-1)?.kind).toBe("ended");
	});

	test("fails when several devices are present and no serial is given", async () => {
		const source = createAdbSource(
			{ adbPath: "adb", serial: null },
			{
				processes: new ScriptedProcessRunner("List of devices attached\nA\tdevice\nB\tdevice\n", []),
				scheduler: new ManualScheduler(),
			},
		);

		const events = await collectKinds(source);
		expect(events[0]).toMatchObject({ kind: "failed", errorKind: "ambiguous-device" });
	});

	test("fails when the selected device is unauthorized", async () => {
		const source = createAdbSource(
			{ adbPath: "adb", serial: "ABC" },
			{
				processes: new ScriptedProcessRunner("List of devices attached\nABC\tunauthorized\n", []),
				scheduler: new ManualScheduler(),
			},
		);

		const events = await collectKinds(source);
		expect(events[0]).toMatchObject({ kind: "failed", errorKind: "unauthorized" });
	});

	test("fails when the selected device is offline", async () => {
		const source = createAdbSource(
			{ adbPath: "adb", serial: "ABC" },
			{
				processes: new ScriptedProcessRunner("List of devices attached\nABC\toffline\n", []),
				scheduler: new ManualScheduler(),
			},
		);

		const events = await collectKinds(source);
		expect(events[0]).toMatchObject({ kind: "failed", errorKind: "device-offline" });
	});

	test("fails when no authorized device is connected", async () => {
		const source = createAdbSource(
			{ adbPath: "adb", serial: null },
			{
				processes: new ScriptedProcessRunner("List of devices attached\n", []),
				scheduler: new ManualScheduler(),
			},
		);

		const events = await collectKinds(source);
		expect(events[0]).toMatchObject({ kind: "failed", errorKind: "no-device" });
	});

	test("drains a stderr flood without losing the stdout packet", async () => {
		const flood = "e".repeat(64 * 1024);

		const source = createAdbSource(
			{ adbPath: "adb", serial: "ABC" },
			{
				processes: new ScriptedProcessRunner("List of devices attached\nABC\tdevice\n", [
					"1760000000.000001  1234  1250 I Tag: after-stderr\n",
				], flood),
				scheduler: new ManualScheduler(),
			},
		);

		const kinds = [];
		let stdoutPackets = 0;
		let stderrPackets = 0;

		for await (const event of source.open(new AbortController().signal)) {
			kinds.push(event.kind);

			if (event.kind !== "chunk") continue;

			if (event.stream === "stdout") stdoutPackets += 1;
			else stderrPackets += 1;
		}

		expect(kinds[0]).toBe("ready");
		expect(stdoutPackets).toBeGreaterThanOrEqual(1);
		expect(stderrPackets).toBeGreaterThanOrEqual(1);
		expect(kinds.at(-1)).toBe("ended");
	});

	test("close stops a live capture before the child exits", async () => {
		let terminated = false;

		const hanging: ProcessRunner = {
			spawn(spec: ProcessSpec): Result<ChildProcessHandle, SourceError> {
				if (spec.args[0] === "devices") {
					return ok(textHandle("List of devices attached\nABC\tdevice\n", ""));
				}

				return ok({
					stdout: hangStream(),
					stderr: once(""),
					exit: new Promise(() => undefined),
					terminate: async () => {
						terminated = true;
					},
				});
			},
		};

		const source = createAdbSource(
			{ adbPath: "adb", serial: "ABC" },
			{ processes: hanging, scheduler: new ManualScheduler() },
		);

		const controller = new AbortController();
		const iter = source.open(controller.signal)[Symbol.asyncIterator]();
		const first = await iter.next();
		expect(first.value).toMatchObject({ kind: "ready" });
		await source.close();
		controller.abort();
		expect(terminated).toBe(true);
	});
});

describe("adb process stubs", () => {
	test("missing executable is adb-missing", async () => {
		const source = createAdbSource(
			{ adbPath: "/no/such/adb-binary", serial: null },
			{ processes: createProcessRunner(), scheduler: createScheduler() },
		);

		const events = await collectKinds(source);
		expect(events[0]).toMatchObject({ kind: "failed", errorKind: "adb-missing" });
	});

	test("one-device stub captures the sanitized logcat profile", async () => {
		const source = createAdbSource(
			{ adbPath: adbStubPath("one-device"), serial: SANITIZED_DEVICE_SERIAL },
			{ processes: createProcessRunner(), scheduler: createScheduler() },
		);

		let ready = false;
		let stdout = 0;

		for await (const event of source.open(new AbortController().signal)) {
			if (event.kind === "ready") ready = true;

			if (event.kind === "chunk" && event.stream === "stdout") stdout += 1;
		}

		expect(ready).toBe(true);
		expect(stdout).toBeGreaterThanOrEqual(1);
	});
});

async function* hangStream(): AsyncIterable<Uint8Array> {
	yield new Uint8Array();
	await new Promise(() => undefined);
}
