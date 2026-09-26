import { err, ok, type ConfigurationError, type Result } from "@logcayo/core";
import { Effect, Match } from "effect";
import type {
	LogSource,
	RecordingEnd,
	RecordingError,
	RecordingFiles,
	RecordingHeader,
	Scheduler,
	SourceError,
	SourceEvent,
} from "./ports.ts";
import { isSourcePacket, isSourceTerminal } from "./ports.ts";
import { encodeRecordingRecord } from "./recording-schema.ts";

export const DEFAULT_MAX_RECORDING_BYTES = 256 * 1024 * 1024;

export const FOOTER_RESERVE_BYTES = 512;

export type RecordOptions = Readonly<{
	outPath: string;
	durationMs: number | null;
	maxFileBytes: number;
	header: RecordingHeader;
}>;

export type RecordOutcome = Readonly<{
	path: string;
	end: RecordingEnd;
}>;

export type RecordFailure = RecordingError | SourceError | ConfigurationError;

export function recordSession(
	source: LogSource,
	options: RecordOptions,
	dependencies: { files: RecordingFiles; scheduler: Scheduler },
	signal: AbortSignal,
): Promise<Result<RecordOutcome, RecordFailure>> {
	return Effect.runPromise(
		recordSessionEffect(source, options, dependencies, signal).pipe(
			Effect.match({
				onFailure: (error) => err(error),
				onSuccess: (value) => ok(value),
			}),
		),
	);
}

function recordSessionEffect(
	source: LogSource,
	options: RecordOptions,
	dependencies: { files: RecordingFiles; scheduler: Scheduler },
	signal: AbortSignal,
): Effect.Effect<RecordOutcome, RecordFailure> {
	return Effect.tryPromise({
		try: () => runRecorder(source, options, dependencies, signal),
		catch: (cause) =>
			mapCause(cause instanceof Error ? cause : new Error("recording failed")),
	}).pipe(Effect.flatMap((result) => (result.ok ? Effect.succeed(result.value) : Effect.fail(result.error))));
}

async function runRecorder(
	source: LogSource,
	options: RecordOptions,
	dependencies: { files: RecordingFiles; scheduler: Scheduler },
	signal: AbortSignal,
): Promise<Result<RecordOutcome, RecordFailure>> {
	if (options.outPath.length === 0) {
		return err({ kind: "invalid-options", field: "outPath", message: "output path is required" });
	}

	if (!Number.isFinite(options.maxFileBytes) || options.maxFileBytes < FOOTER_RESERVE_BYTES) {
		return err({
			kind: "invalid-options",
			field: "maxFileBytes",
			message: "maxFileBytes must leave room for a footer",
		});
	}

	if (options.durationMs !== null && (!Number.isFinite(options.durationMs) || options.durationMs <= 0)) {
		return err({
			kind: "invalid-options",
			field: "durationMs",
			message: "duration must be a positive number of milliseconds",
		});
	}

	const created = await dependencies.files.create(options.outPath, options.header);

	if (!created.ok) return created;

	const writer = created.value;
	let written = encodeRecordingRecord(options.header).byteLength;

	if (written + FOOTER_RESERVE_BYTES > options.maxFileBytes) {
		await writer.abort();

		return err({ kind: "invalid", message: "recording header exceeds the capture size limit" });
	}

	const started = dependencies.scheduler.nowMs();
	let chunks = 0;
	let sourceError: SourceError | null = null;
	let outcome: RecordingEnd["outcome"] = "eof";
	const abort = new AbortController();
	const onAbort = (): void => abort.abort();

	signal.addEventListener("abort", onAbort);

	let durationCancel: (() => void) | null = null;

	if (options.durationMs !== null) {
		durationCancel = dependencies.scheduler.after(options.durationMs, () => abort.abort());
	}

	try {
		for await (const event of source.open(abort.signal)) {
			if (signal.aborted) {
				outcome = "user-stop";
				break;
			}

			if (options.durationMs !== null && dependencies.scheduler.nowMs() - started >= options.durationMs) {
				outcome = "user-stop";
				break;
			}

			const handled = await handleEvent(event, writer, written, options.maxFileBytes, chunks);

			if (handled.kind === "continue") {
				written = handled.written;
				chunks = handled.chunks;
				continue;
			}

			if (handled.kind === "size-limit") {
				outcome = "size-limit";
				written = handled.written;
				chunks = handled.chunks;
				break;
			}

			if (handled.kind === "failed") {
				sourceError = handled.error;
				outcome = "source-failure";
				break;
			}

			if (handled.kind === "ended") {
				outcome = handled.reason === "stopped" ? "user-stop" : "eof";
				break;
			}

			if (handled.kind === "write-error") {
				await writer.abort();

				return err(handled.error);
			}
		}

		await source.close();
		durationCancel?.();
		signal.removeEventListener("abort", onAbort);

		const end: RecordingEnd = {
			kind: "end",
			chunks,
			outcome,
			error: outcome === "source-failure" ? sourceError : null,
		};

		const finalized = await writer.finalize(end);

		if (!finalized.ok) return finalized;

		if (sourceError) return err(sourceError);

		return ok({ path: options.outPath, end });
	} catch (cause) {
		durationCancel?.();
		signal.removeEventListener("abort", onAbort);
		await writer.abort();
		await source.close().catch(() => undefined);

		return err(mapCause(cause instanceof Error ? cause : new Error("recording failed")));
	}
}

type HandleResult =
	| { kind: "continue"; written: number; chunks: number }
	| { kind: "size-limit"; written: number; chunks: number }
	| { kind: "ended"; reason: "eof" | "stopped" }
	| { kind: "failed"; error: SourceError }
	| { kind: "write-error"; error: RecordingError };

async function handleEvent(
	event: SourceEvent,
	writer: import("./ports.ts").RecordingWriter,
	written: number,
	maxFileBytes: number,
	chunks: number,
): Promise<HandleResult> {
	if (isSourcePacket(event)) {
		const encoded = encodeRecordingRecord({
			kind: "chunk",
			packetSeq: event.packetSeq,
			offsetMs: event.offsetMs,
			stream: event.stream,
			base64: Buffer.from(event.bytes).toString("base64"),
		});

		if (written + encoded.byteLength + FOOTER_RESERVE_BYTES > maxFileBytes) {
			return { kind: "size-limit", written, chunks };
		}

		const appended = await writer.append(event);

		if (!appended.ok) return { kind: "write-error", error: appended.error };

		return { kind: "continue", written: written + encoded.byteLength, chunks: chunks + 1 };
	}

	if (isSourceTerminal(event)) {
		return Match.value(event).pipe(
			Match.when({ kind: "ended" }, (ended) => ({
				kind: "ended" as const,
				reason: ended.reason,
			})),
			Match.when({ kind: "failed" }, (failed) => ({
				kind: "failed" as const,
				error: failed.error,
			})),
			Match.exhaustive,
		);
	}

	return { kind: "continue", written, chunks };
}

function mapCause(error: Error): RecordFailure {
	return { kind: "io", message: error.message };
}
