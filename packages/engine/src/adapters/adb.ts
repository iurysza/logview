import { err, ok, MAX_PACKET_BYTES, type Result } from "@logview/core";
import type {
	LogSource,
	ProcessRunner,
	Scheduler,
	SourceError,
	SourceEvent,
	SourcePacket,
} from "../ports.ts";

export type AdbSourceOptions = Readonly<{
	adbPath: string;
	serial: string | null;
}>;

export const LOGCAT_ARGS = [
	"logcat",
	"-b",
	"main",
	"-b",
	"system",
	"-b",
	"crash",
	"-v",
	"threadtime",
	"-v",
	"epoch",
	"-v",
	"usec",
	"*:V",
] as const;

export function createAdbSource(
	options: AdbSourceOptions,
	dependencies: { processes: ProcessRunner; scheduler: Scheduler },
): LogSource {
	return new AdbSource(options, dependencies);
}

class AdbSource implements LogSource {
	readonly maxBufferedBytes = MAX_PACKET_BYTES * 2;
	private opened = false;
	private closed = false;
	private child: import("../ports.ts").ChildProcessHandle | null = null;

	constructor(
		private readonly options: AdbSourceOptions,
		private readonly deps: { processes: ProcessRunner; scheduler: Scheduler },
	) {}

	async *open(signal: AbortSignal): AsyncIterable<SourceEvent> {
		if (this.opened) {
			yield { kind: "failed", error: { kind: "io", message: "source already opened" } };

			return;
		}

		this.opened = true;
		const devices = await this.listDevices();

		if (!devices.ok) {
			yield { kind: "failed", error: devices.error };

			return;
		}

		const serial = selectSerial(devices.value, this.options.serial);

		if (!serial.ok) {
			yield { kind: "failed", error: serial.error };

			return;
		}

		const spawned = this.deps.processes.spawn({
			file: this.options.adbPath,
			args: ["-s", serial.value, ...LOGCAT_ARGS],
			env: cleanAdbEnv(),
		});

		if (!spawned.ok) {
			yield { kind: "failed", error: spawned.error };

			return;
		}

		this.child = spawned.value;

		const onAbort = (): void => {
			void this.close().catch(() => undefined);
		};

		signal.addEventListener("abort", onAbort, { once: true });

		try {
			yield { kind: "ready" };

			const merged = mergeStreams(spawned.value.stdout, spawned.value.stderr, this.deps.scheduler, signal);

			for await (const packet of merged) {
				if (this.closed || signal.aborted) break;
				yield packet;
			}

			const exit = await spawned.value.exit;

			if (this.closed || signal.aborted) {
				yield { kind: "ended", reason: "stopped" };

				return;
			}

			if (exit.code === 0) {
				yield { kind: "ended", reason: "eof" };

				return;
			}

			yield {
				kind: "failed",
				error: {
					kind: "process-exit",
					message: `adb logcat exited with code ${exit.code ?? "null"}`,
					exitCode: exit.code ?? undefined,
				},
			};
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;

		this.closed = true;

		if (this.child) await this.child.terminate(1000);
	}

	private async listDevices(): Promise<Result<DeviceRow[], SourceError>> {
		const spawned = this.deps.processes.spawn({
			file: this.options.adbPath,
			args: ["devices"],
			env: cleanAdbEnv(),
		});

		if (!spawned.ok) return spawned;

		const text = await readAllText(spawned.value.stdout);
		await spawned.value.exit;

		return ok(parseDevices(text));
	}
}

type DeviceRow = Readonly<{ serial: string; state: string }>;

function selectSerial(devices: readonly DeviceRow[], requested: string | null): Result<string, SourceError> {
	if (requested !== null) {
		const match = devices.find((device) => device.serial === requested);

		if (!match) {
			return err({ kind: "no-device", message: `device ${requested} was not found` });
		}

		if (match.state === "unauthorized") {
			return err({ kind: "unauthorized", message: `device ${requested} is unauthorized` });
		}

		if (match.state !== "device") {
			return err({ kind: "device-offline", message: `device ${requested} is ${match.state}` });
		}

		return ok(requested);
	}

	const usable = devices.filter((device) => device.state === "device");

	if (usable.length === 0) {
		return err({ kind: "no-device", message: "no authorized device is connected" });
	}

	if (usable.length > 1) {
		return err({ kind: "ambiguous-device", message: "more than one authorized device is connected" });
	}

	return ok(usable[0]!.serial);
}

function parseDevices(text: string): DeviceRow[] {
	const rows: DeviceRow[] = [];
	const lines = text.split(/\r?\n/);

	for (const line of lines) {
		if (line.length === 0 || line.startsWith("List of devices")) continue;

		const parts = line.split(/\s+/);
		const serial = parts[0];
		const state = parts[1];

		if (serial && state) rows.push({ serial, state });
	}

	return rows;
}

function cleanAdbEnv(): AdbProcessEnv {
	const path = process.env.PATH ?? "/usr/bin:/bin";
	const home = process.env.HOME ?? "";

	return { PATH: path, HOME: home };
}

type AdbProcessEnv = Readonly<{
	PATH: string;
	HOME: string;
}>;

async function readAllText(stream: AsyncIterable<Uint8Array>): Promise<string> {
	const chunks: Uint8Array[] = [];
	let total = 0;

	for await (const chunk of stream) {
		chunks.push(chunk);
		total += chunk.byteLength;
	}

	const merged = new Uint8Array(total);
	let offset = 0;

	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new TextDecoder().decode(merged);
}

type StreamWaiter = {
	current: (() => void) | null;
};

async function* mergeStreams(
	stdout: AsyncIterable<Uint8Array>,
	stderr: AsyncIterable<Uint8Array>,
	scheduler: Scheduler,
	signal: AbortSignal,
): AsyncIterable<SourcePacket> {
	const start = scheduler.nowMs();
	const queue: SourcePacket[] = [];
	let seq = 0;
	const waiter: StreamWaiter = { current: null };
	let stdoutDone = false;
	let stderrDone = false;

	const wake = (): void => {
		const current = waiter.current;
		waiter.current = null;

		if (current) current();
	};

	const push = (stream: "stdout" | "stderr", bytes: Uint8Array): void => {
		queue.push({
			kind: "chunk",
			packetSeq: seq,
			offsetMs: Math.max(0, scheduler.nowMs() - start),
			stream,
			bytes,
		});
		seq += 1;
		wake();
	};

	const stdoutTask = (async () => {
		for await (const bytes of stdout) push("stdout", bytes);
		stdoutDone = true;
		wake();
	})();

	const stderrTask = (async () => {
		for await (const bytes of stderr) push("stderr", bytes);
		stderrDone = true;
		wake();
	})();

	while (!stdoutDone || !stderrDone || queue.length > 0) {
		if (signal.aborted) break;

		if (queue.length === 0) {
			await new Promise<void>((resolve) => {
				waiter.current = resolve;
			});
			continue;
		}

		const packet = queue.shift();

		if (packet) yield packet;
	}

	await Promise.allSettled([stdoutTask, stderrTask]);
}

