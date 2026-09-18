import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@logview/core";
import { createAdbSource, type ChildProcessHandle, type ProcessRunner, type ProcessSpec, type SourceError } from "@logview/engine";
import { ManualScheduler } from "../../../tests/support/manual-scheduler.ts";

class ScriptedProcessRunner implements ProcessRunner {
	constructor(
		private readonly devices: string,
		private readonly logLines: string[],
	) {}

	spawn(spec: ProcessSpec): Result<ChildProcessHandle, SourceError> {
		if (spec.args[0] === "devices") {
			return ok(textHandle(this.devices, ""));
		}

		if (spec.args.includes("logcat")) {
			return ok(textHandle(this.logLines.join(""), ""));
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

		const events = [];

		for await (const event of source.open(new AbortController().signal)) {
			events.push(event.kind);
		}

		expect(events[0]).toBe("ready");
		expect(events).toContain("chunk");
		expect(events.at(-1)).toBe("ended");
	});

	test("fails when several devices are present and no serial is given", async () => {
		const source = createAdbSource(
			{ adbPath: "adb", serial: null },
			{
				processes: new ScriptedProcessRunner("List of devices attached\nA\tdevice\nB\tdevice\n", []),
				scheduler: new ManualScheduler(),
			},
		);

		const events = [];

		for await (const event of source.open(new AbortController().signal)) {
			events.push(event);
		}

		expect(events[0]).toMatchObject({ kind: "failed", error: { kind: "ambiguous-device" } });
	});
});
