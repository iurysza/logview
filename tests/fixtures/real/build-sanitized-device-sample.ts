import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	chunkFromPacket,
	encodeRecordingRecord,
	sanitizedRecordingHeader,
	type RecordingRecord,
} from "@logview/engine";

export const SANITIZED_DEVICE_SAMPLE_RECORDING_NAME = "sanitized-device-sample-500.lvr.jsonl";

export const SANITIZED_DEVICE_SAMPLE_REDACTION_VERSION = "2026-09-20.public-device-sample.v1";

/**
 * Severity-only shape sampled from a private capture. All timestamps, IDs, tags,
 * messages, and stack frames below are generated public data.
 */
const LEVELS = [
	"DDIDDIDDDIDDDWDDVVVVVVDIDWDDDDIDDDDEIIIIDDDDIVIIVIDDDIDIDDDDDIDEDEVVVVVVDDDIIDDIWDIWDDWWIDDDIIIDIIDD",
	"IIDIIIIDDDIDIIIDIDIIDVVDDIDDVDDDWDDIDDIIDDDIIIDIIIDDIDIIDWIIDDIDIIDDDDWDDIDIIWIDIWIIDIDIIDEIVIIIDDIV",
	"DIWIIIIIIIIWIIIIIDDDWDIDDWDIIDIVDDIIWVDDIDDWIDIIDDEIEIIIDDDDIWIEIIEVIIWIEIIIDWDIIIWIIDDDIIIDIIEIDIIE",
	"IEIDDVIDIIIIIEWEWIIVIIWDIDIWIIIIWIEIIDIIDDWIIVDWIWIDVDDIIDDDDIIIIIVVVVVVDIIDIIIIIIIIIIVIIDIIEDDIDDWV",
	"WWWDVIDIDIDWVIIWEDIIIIIWIIIIDDDIDIDIDWIDVIDIIVWDDDWDVDIIIDIDDIWDIDIIIIIIWIDIIWIIIIIIIIDWIDIDIDDDIIII",
].join("");

const MESSAGES = {
	V: "verbose component update",
	D: "background work completed",
	I: "service state changed",
	W: "retry after timeout",
	E: "operation failed safely",
	F: "fatal component failure",
} as const satisfies Record<"V" | "D" | "I" | "W" | "E" | "F", string>;

function isSampleLevel(level: string): level is keyof typeof MESSAGES {
	return level in MESSAGES;
}

function logLine(index: number, level: string): string {
	const micros = String((index + 1) * 1_997).padStart(6, "0");
	const pid = String(2_000 + (index % 31)).padStart(5, " ");
	const tid = String(2_100 + (index % 47)).padStart(5, " ");
	const tag = `Component${String((index % 17) + 1).padStart(2, "0")}`;
	const message = isSampleLevel(level) ? MESSAGES[level] : MESSAGES.I;

	return `1761000000.${micros} ${pid} ${tid} ${level} ${tag}: ${message}`;
}

export function buildSanitizedDeviceSampleBytes(): Uint8Array {
	const lines: string[] = [];

	for (let index = 0; index < LEVELS.length; index += 1) {
		lines.push(logLine(index, LEVELS[index]!));

		if (index % 73 === 0) lines.push("\tat example.Component.handle(Component.java:42)");
	}

	const header = {
		...sanitizedRecordingHeader(),
		redactionVersion: SANITIZED_DEVICE_SAMPLE_REDACTION_VERSION,
	};

	const records: RecordingRecord[] = [header];

	for (let start = 0; start < lines.length; start += 25) {
		const packetSeq = records.length - 1;
		const text = `${lines.slice(start, start + 25).join("\n")}\n`;

		records.push(
			chunkFromPacket({
				kind: "chunk",
				packetSeq,
				offsetMs: packetSeq * 25,
				stream: "stdout",
				bytes: new TextEncoder().encode(text),
			}),
		);
	}

	records.push({
		kind: "end" as const,
		chunks: records.length - 1,
		outcome: "eof" as const,
		error: null,
	});

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

export function sanitizedDeviceSamplePath(fromDir = import.meta.dir): string {
	return join(fromDir, SANITIZED_DEVICE_SAMPLE_RECORDING_NAME);
}

if (import.meta.main) {
	const path = sanitizedDeviceSamplePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buildSanitizedDeviceSampleBytes());
	process.stdout.write(`${path}\n`);
}
