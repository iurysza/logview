import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	chunkFromPacket,
	encodeRecordingRecord,
	sanitizedRecordingHeader,
} from "@logview/engine";
import { SANITIZED_LOGCAT, SANITIZED_STDERR } from "./sanitized-payload.ts";

export const SANITIZED_RECORDING_NAME = "sanitized-aosp-pattern.lvr.jsonl";

export function cafeSplitIndex(text: string): number {
	const cafe = Buffer.from(text, "utf8");
	const needle = Buffer.from("café", "utf8");
	const start = cafe.indexOf(needle);

	if (start < 0) throw new Error("café marker missing from sanitized payload");

	const accent = start + Buffer.from("caf", "utf8").byteLength;

	return accent + 1;
}

export function buildSanitizedRecordingBytes(): Uint8Array {
	const stdout = Buffer.from(SANITIZED_LOGCAT, "utf8");
	const split = cafeSplitIndex(SANITIZED_LOGCAT);
	const first = stdout.subarray(0, split);
	const second = stdout.subarray(split);
	const stderr = Buffer.from(SANITIZED_STDERR, "utf8");
	const header = sanitizedRecordingHeader();

	const records = [
		header,
		chunkFromPacket({
			kind: "chunk",
			packetSeq: 0,
			offsetMs: 0,
			stream: "stdout",
			bytes: new Uint8Array(first),
		}),
		chunkFromPacket({
			kind: "chunk",
			packetSeq: 1,
			offsetMs: 3,
			stream: "stdout",
			bytes: new Uint8Array(second),
		}),
		chunkFromPacket({
			kind: "chunk",
			packetSeq: 2,
			offsetMs: 4,
			stream: "stderr",
			bytes: new Uint8Array(stderr),
		}),
		{
			kind: "end" as const,
			chunks: 3,
			outcome: "eof" as const,
			error: null,
		},
	];

	const parts = records.map((record) => encodeRecordingRecord(record));
	let total = 0;

	for (const part of parts) total += part.byteLength;

	const out = new Uint8Array(total);
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}

	return out;
}

export function sanitizedRecordingPath(fromDir = import.meta.dir): string {
	return join(fromDir, SANITIZED_RECORDING_NAME);
}

if (import.meta.main) {
	const path = sanitizedRecordingPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buildSanitizedRecordingBytes());
	process.stdout.write(`${path}\n`);
}
