import { err, ok, type Result } from "@logview/core";
import { appendFile } from "node:fs/promises";
import { link, unlink } from "node:fs/promises";
import type {
	RecordingError,
	RecordingFiles,
	RecordingHeader,
	RecordingRecord,
	RecordingWriter,
	SourcePacket,
} from "../ports.ts";
import {
	chunkFromPacket,
	decodeRecordingLine,
	encodeRecordingRecord,
	invalidRecording,
} from "../recording-schema.ts";

export class BunRecordingFiles implements RecordingFiles {
	async create(path: string, header: RecordingHeader): Promise<Result<RecordingWriter, RecordingError>> {
		try {
			if (await Bun.file(path).exists()) {
				return err({ kind: "exists", message: "destination exists" });
			}

			const partialPath = `${path}.partial`;
			await Bun.write(partialPath, encodeRecordingRecord(header));
			return ok(new BunRecordingWriter(path, partialPath));
		} catch (cause) {
			return err(
				mapFsError(cause instanceof Error ? cause : new Error("recording file operation failed")),
			);
		}
	}

	async *read(path: string, signal: AbortSignal): AsyncIterable<Result<RecordingRecord, RecordingError>> {
		const file = Bun.file(path);

		if (!(await file.exists())) {
			yield err({ kind: "io", message: `recording not found: ${path}` });
			return;
		}

		const text = await file.text();
		const lines = text.split("\n");

		for (let i = 0; i < lines.length; i += 1) {
			if (signal.aborted) return;

			const line = lines[i] ?? "";
			const isLast = i === lines.length - 1;

			if (line.length === 0 && isLast) continue;

			const lineNumber = i + 1;

			if (line.length === 0) {
				yield err(invalidRecording("empty recording line", lineNumber));
				return;
			}

			if (isLast && !text.endsWith("\n")) {
				yield err({
					kind: "incomplete-final-line",
					message: "final JSON line is incomplete",
					line: lineNumber,
				});
				return;
			}

			const decoded = decodeRecordingLine(line, lineNumber);
			yield decoded;

			if (!decoded.ok) return;
		}
	}
}

class BunRecordingWriter implements RecordingWriter {
	constructor(
		private readonly dest: string,
		private readonly partialPath: string,
	) {}

	async append(packet: SourcePacket): Promise<Result<void, RecordingError>> {
		try {
			await appendFile(this.partialPath, encodeRecordingRecord(chunkFromPacket(packet)));
			return ok(undefined);
		} catch (cause) {
			return err(
				mapFsError(cause instanceof Error ? cause : new Error("recording file operation failed")),
			);
		}
	}

	async finalize(end: import("../ports.ts").RecordingEnd): Promise<Result<void, RecordingError>> {
		try {
			await appendFile(this.partialPath, encodeRecordingRecord(end));

			if (await Bun.file(this.dest).exists()) {
				await unlink(this.partialPath).catch(() => undefined);
				return err({ kind: "exists", message: "destination exists" });
			}

			await link(this.partialPath, this.dest);
			await unlink(this.partialPath);
			return ok(undefined);
		} catch (cause) {
			return err(
				mapFsError(cause instanceof Error ? cause : new Error("recording file operation failed")),
			);
		}
	}

	async abort(): Promise<void> {
		await unlink(this.partialPath).catch(() => undefined);
	}
}

function mapFsError(error: Error): RecordingError {
	if (hasErrno(error) && error.code === "EACCES") {
		return { kind: "permission", message: "permission denied" };
	}

	if (hasErrno(error) && (error.code === "ENOSPC" || error.code === "EDQUOT")) {
		return { kind: "disk-full", message: "disk is full" };
	}

	return { kind: "io", message: error.message };
}

function hasErrno(cause: unknown): cause is Error & { code: string } {
	if (!(cause instanceof Error)) return false;

	return "code" in cause;
}

export function createRecordingFiles(): RecordingFiles {
	return new BunRecordingFiles();
}
