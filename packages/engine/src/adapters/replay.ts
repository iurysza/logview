import { err, ok, MAX_PACKET_BYTES, type ConfigurationError, type Result } from "@logcayo/core";
import { Effect, Match } from "effect";
import type {
	LogSource,
	RecordingError,
	RecordingFiles,
	RecordingRecord,
	Scheduler,
	SourceEvent,
} from "../ports.ts";
import {
	emptyRecordingSequence,
	packetFromChunk,
	validateRecordingSequence,
} from "../recording-schema.ts";

export type ReplayOptions = Readonly<{
	path: string;
	speed: { kind: "timed"; multiplier: number } | { kind: "instant" };
	allowPartial: boolean;
}>;

export function createReplaySource(
	options: ReplayOptions,
	dependencies: { files: RecordingFiles; scheduler: Scheduler },
): Result<LogSource, ConfigurationError> {
	if (options.speed.kind === "timed") {
		if (!Number.isFinite(options.speed.multiplier) || options.speed.multiplier <= 0) {
			return err({
				kind: "invalid-options",
				field: "speed",
				message: "speed multiplier must be finite and greater than zero",
			});
		}
	}

	if (options.path.length === 0) {
		return err({
			kind: "invalid-options",
			field: "path",
			message: "recording path is required",
		});
	}

	return ok(new ReplaySource(options, dependencies));
}

class ReplaySource implements LogSource {
	readonly maxBufferedBytes = MAX_PACKET_BYTES;
	private opened = false;
	private closed = false;

	constructor(
		private readonly options: ReplayOptions,
		private readonly deps: { files: RecordingFiles; scheduler: Scheduler },
	) {}

	async *open(signal: AbortSignal): AsyncIterable<SourceEvent> {
		if (this.opened) {
			yield { kind: "failed", error: { kind: "io", message: "source already opened" } };

			return;
		}

		this.opened = true;
		const start = this.deps.scheduler.nowMs();
		let sequence = emptyRecordingSequence();
		let ready = false;
		let lineNumber = 0;
		let sawIncomplete = false;

		try {
			for await (const record of this.deps.files.read(this.options.path, signal)) {
				if (this.closed || signal.aborted) break;

				lineNumber += 1;

				if (!record.ok) {
					if (record.error.kind === "incomplete-final-line" && this.options.allowPartial) {
						sawIncomplete = true;
						break;
					}

					yield {
						kind: "failed",
						error: { kind: "recording-invalid", message: record.error.message },
					};

					return;
				}

				const next = validateRecordingSequence(sequence, record.value);

				if (!next.ok) {
					yield {
						kind: "failed",
						error: { kind: "recording-invalid", message: next.error.message },
					};

					return;
				}

				sequence = next.value;

				const event = await this.handleRecord(record.value, start, signal);

				if (!event) continue;

				if (!ready) {
					yield { kind: "ready" };
					ready = true;
				}

				yield event;

				if (event.kind === "ended" || event.kind === "failed") return;
			}
		} catch (cause) {
			yield {
				kind: "failed",
				error: { kind: "io", message: cause instanceof Error ? cause.message : "replay failed" },
			};

			return;
		}

		if (!ready) yield { kind: "ready" };

		if (sawIncomplete) {
			yield {
				kind: "notice",
				code: "partial-recording",
				message: "replay used a valid prefix of an unfinalized recording",
			};
			yield { kind: "ended", reason: "eof" };

			return;
		}

		if (!sequence.ended && !this.options.allowPartial) {
			yield {
				kind: "failed",
				error: { kind: "recording-invalid", message: "recording is missing a footer" },
			};

			return;
		}

		if (!sequence.ended && this.options.allowPartial) {
			yield {
				kind: "notice",
				code: "partial-recording",
				message: "replay used a valid prefix of an unfinalized recording",
			};
		}

		yield { kind: "ended", reason: "eof" };
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	private async handleRecord(
		record: RecordingRecord,
		start: number,
		signal: AbortSignal,
	): Promise<SourceEvent | null> {
		return Match.value(record).pipe(
			Match.when({ kind: "header", version: 1 }, () =>
				Effect.runPromise(
					Effect.succeed<SourceEvent | null>({ kind: "package-table", packageTable: { kind: "not-recorded" } }),
				),
			),
			Match.when({ kind: "header", version: 2 }, (header) =>
				Effect.runPromise(
					Effect.succeed<SourceEvent | null>({
						kind: "package-table",
						packageTable: { kind: "recorded", table: header.packageTable },
					}),
				),
			),
			Match.when({ kind: "chunk" }, (chunk) => this.emitChunk(chunk, start, signal)),
			Match.when({ kind: "end" }, (end) => Effect.runPromise(Effect.succeed<SourceEvent | null>(this.endEvent(end)))),
			Match.exhaustive,
		);
	}

	private async emitChunk(
		chunk: Extract<RecordingRecord, { kind: "chunk" }>,
		start: number,
		signal: AbortSignal,
	): Promise<SourceEvent | null> {
		const packet = packetFromChunk(chunk);

		if (!packet.ok) {
			return { kind: "failed", error: { kind: "recording-invalid", message: packet.error.message } };
		}

		if (this.options.speed.kind === "timed") {
			const due = start + packet.value.offsetMs / this.options.speed.multiplier;
			const delay = due - this.deps.scheduler.nowMs();

			if (delay > 0 && !signal.aborted) {
				await sleep(this.deps.scheduler, delay);
			}
		}

		return packet.value;
	}

	private endEvent(end: Extract<RecordingRecord, { kind: "end" }>): SourceEvent {
		if (end.outcome === "source-failure") {
			return {
				kind: "failed",
				error: end.error ?? { kind: "io", message: "recorded source failure" },
			};
		}

		if (end.outcome === "size-limit") {
			return {
				kind: "notice",
				code: "capture-size-limit",
				message: "recording stopped at the capture size limit",
			};
		}

		return { kind: "ended", reason: "eof" };
	}
}

function sleep(scheduler: Scheduler, delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		scheduler.after(delayMs, resolve);
	});
}

export type { RecordingError };
