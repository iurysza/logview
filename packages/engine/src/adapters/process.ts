import { err, ok, type Result } from "@logview/core";
import { MAX_PACKET_BYTES } from "@logview/core";
import { Effect, Either } from "effect";
import type {
	ChildProcessHandle,
	ProcessExit,
	ProcessRunner,
	ProcessSpec,
	SourceError,
} from "../ports.ts";

export class BunProcessRunner implements ProcessRunner {
	spawn(spec: ProcessSpec): Result<ChildProcessHandle, SourceError> {
		const either = Effect.runSync(
			Effect.either(
				Effect.try({
					try: () => spawnHandle(spec),
					catch: (cause) => spawnFailure(cause instanceof Error ? cause : new Error("failed to spawn process")),
				}),
			),
		);

		return Either.match(either, {
			onLeft: (error) => err(error),
			onRight: (handle) => ok(handle),
		});
	}
}

export function createProcessRunner(): ProcessRunner {
	return new BunProcessRunner();
}

function spawnHandle(spec: ProcessSpec): ChildProcessHandle {
	const subprocess = Bun.spawn([spec.file, ...spec.args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
		env: spec.env,
	});

	return {
		stdout: splitChunks(subprocess.stdout),
		stderr: splitChunks(subprocess.stderr),
		exit: subprocess.exited.then((code): ProcessExit => ({ code, signal: null })),
		terminate: async (graceMs: number) => {
			subprocess.kill("SIGTERM");
			const force = setTimeout(() => {
				subprocess.kill("SIGKILL");
			}, graceMs);

			await subprocess.exited;
			clearTimeout(force);
		},
	};
}

async function* splitChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
	const reader = stream.getReader();

	try {
		while (true) {
			const next = await reader.read();

			if (next.done) return;

			const bytes = next.value;
			let offset = 0;

			while (offset < bytes.byteLength) {
				const end = Math.min(offset + MAX_PACKET_BYTES, bytes.byteLength);
				yield bytes.subarray(offset, end);
				offset = end;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function spawnFailure(error: Error): SourceError {
	if (hasErrno(error) && error.code === "ENOENT") {
		return { kind: "adb-missing", message: "executable not found" };
	}

	return { kind: "io", message: "failed to spawn process" };
}

function hasErrno(cause: unknown): cause is { code: string } {
	if (!(cause instanceof Error)) return false;

	return "code" in cause;
}
