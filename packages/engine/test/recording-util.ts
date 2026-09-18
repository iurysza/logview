import { err, ok, type Result } from "@logview/core";
import type {
	RecordingEnd,
	RecordingError,
	RecordingFiles,
	RecordingHeader,
	RecordingRecord,
	RecordingWriter,
	SourcePacket,
} from "@logview/engine";
import {
	bytesToBase64,
	decodeRecordingLine,
	encodeRecordingRecord,
	syntheticRecordingHeader,
} from "@logview/engine";

class MemoryWriter implements RecordingWriter {
	constructor(
		private readonly files: Map<string, string>,
		private readonly path: string,
		private buffer: string,
	) {}

	async append(packet: SourcePacket): Promise<Result<void, RecordingError>> {
		const record: RecordingRecord = {
			kind: "chunk",
			packetSeq: packet.packetSeq,
			offsetMs: packet.offsetMs,
			stream: packet.stream,
			base64: bytesToBase64(packet.bytes),
		};

		this.buffer += new TextDecoder().decode(encodeRecordingRecord(record));

		return ok(undefined);
	}

	async finalize(end: RecordingEnd): Promise<Result<void, RecordingError>> {
		this.buffer += new TextDecoder().decode(encodeRecordingRecord(end));

		if (this.files.has(this.path)) return err({ kind: "exists", message: "exists" });
		this.files.set(this.path, this.buffer);

		return ok(undefined);
	}

	async abort(): Promise<void> {
		this.buffer = "";
	}
}

export class MemoryRecordingFiles implements RecordingFiles {
	readonly files = new Map<string, string>();

	async create(path: string, header: RecordingHeader): Promise<Result<RecordingWriter, RecordingError>> {
		if (this.files.has(path)) return err({ kind: "exists", message: `${path} exists` });
		const buffer = new TextDecoder().decode(encodeRecordingRecord(header));

		return ok(new MemoryWriter(this.files, path, buffer));
	}

	async *read(path: string, _signal: AbortSignal): AsyncIterable<Result<RecordingRecord, RecordingError>> {
		const body = this.files.get(path);

		if (body === undefined) {
			yield err({ kind: "io", message: "missing" });

			return;
		}

		const lines = body.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;

			if (line.length === 0) continue;

			try {
				yield decodeRecordingLine(line, i + 1);
			} catch {
				yield err({ kind: "invalid", message: "malformed complete JSON line", line: i + 1 });

				return;
			}
		}
	}
}

export async function writeRecording(
	files: MemoryRecordingFiles,
	path: string,
	packets: readonly SourcePacket[],
	end: RecordingEnd = { kind: "end", chunks: packets.length, outcome: "eof", error: null },
): Promise<void> {
	const created = await files.create(path, syntheticRecordingHeader());

	if (!created.ok) throw new Error(created.error.message);

	for (const packet of packets) {
		const appended = await created.value.append(packet);

		if (!appended.ok) throw new Error(appended.error.message);
	}

	const finalized = await created.value.finalize(end);

	if (!finalized.ok) throw new Error(finalized.error.message);
}
