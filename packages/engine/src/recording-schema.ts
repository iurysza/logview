import { err, ok, type Result } from "@logview/core";
import { MAX_PACKET_BYTES, MAX_RECORDING_LINE_BYTES } from "@logview/core";
import { Either, Match, Schema } from "effect";
import type {
	RecordingError,
	RecordingHeader,
	RecordingRecord,
	SourceError,
	SourcePacket,
} from "./ports.ts";

export type RecordingSequenceState = Readonly<{
	headerSeen: boolean;
	expectedPacketSeq: number;
	lastOffsetMs: number;
	ended: boolean;
}>;

const sourceErrorKind = Schema.Literal(
	"adb-missing",
	"no-device",
	"ambiguous-device",
	"unauthorized",
	"device-offline",
	"unsupported-format",
	"process-exit",
	"recording-invalid",
	"io",
);

const SourceErrorSchema = Schema.Struct({
	kind: sourceErrorKind,
	message: Schema.String,
	exitCode: Schema.optional(Schema.Number),
});

const HeaderSchema = Schema.Struct({
	kind: Schema.Literal("header"),
	format: Schema.Literal("logview-recording"),
	version: Schema.Literal(1),
	profile: Schema.Literal("threadtime-epoch-usec-v1"),
	provenance: Schema.Literal("raw-capture", "sanitized-real", "synthetic"),
	redactionVersion: Schema.NullOr(Schema.String),
});

const ChunkSchema = Schema.Struct({
	kind: Schema.Literal("chunk"),
	packetSeq: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	offsetMs: Schema.Number.pipe(Schema.finite(), Schema.greaterThanOrEqualTo(0)),
	stream: Schema.Literal("stdout", "stderr"),
	base64: Schema.String,
});

const EndSchema = Schema.Struct({
	kind: Schema.Literal("end"),
	chunks: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	outcome: Schema.Literal("eof", "user-stop", "size-limit", "source-failure"),
	error: Schema.NullOr(SourceErrorSchema),
});

const RecordingRecordSchema = Schema.Union(HeaderSchema, ChunkSchema, EndSchema);

const RecordingLineSchema = Schema.parseJson(RecordingRecordSchema);

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function emptyRecordingSequence(): RecordingSequenceState {
	return {
		headerSeen: false,
		expectedPacketSeq: 0,
		lastOffsetMs: 0,
		ended: false,
	};
}

export function invalidRecording(message: string, line?: number): RecordingError {
	return line === undefined ? { kind: "invalid", message } : { kind: "invalid", message, line };
}

export function decodeBase64Strict(text: string): Result<Uint8Array, RecordingError> {
	if (text.length % 4 !== 0 || !BASE64_RE.test(text)) {
		return err(invalidRecording("base64 is not strictly encoded"));
	}

	try {
		const decoded = Buffer.from(text, "base64");

		if (decoded.byteLength > MAX_PACKET_BYTES) {
			return err(invalidRecording(`decoded packet exceeds ${MAX_PACKET_BYTES} bytes`));
		}

		if (decoded.toString("base64") !== text) {
			return err(invalidRecording("base64 is not strictly encoded"));
		}

		return ok(new Uint8Array(decoded));
	} catch {
		return err(invalidRecording("base64 is not strictly encoded"));
	}
}

export function encodeBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

export function decodeRecordingLine(line: string, lineNumber: number): Result<RecordingRecord, RecordingError> {
	if (Buffer.byteLength(line, "utf8") > MAX_RECORDING_LINE_BYTES) {
		return err(invalidRecording(`recording line exceeds ${MAX_RECORDING_LINE_BYTES} bytes`, lineNumber));
	}

	const decoded = Schema.decodeEither(RecordingLineSchema)(line);

	return Either.match(decoded, {
		onLeft: (error) => err(invalidRecording(error.message, lineNumber)),
		onRight: (record) => ok(record),
	});
}

export function decodeRecordingRecord(jsonLine: string): Result<RecordingRecord, RecordingError> {
	return decodeRecordingLine(jsonLine, 1);
}

export function packetFromChunk(record: Extract<RecordingRecord, { kind: "chunk" }>): Result<SourcePacket, RecordingError> {
	const bytes = decodeBase64Strict(record.base64);

	if (!bytes.ok) return bytes;

	return ok({
		kind: "chunk",
		packetSeq: record.packetSeq,
		offsetMs: record.offsetMs,
		stream: record.stream,
		bytes: bytes.value,
	});
}

export function encodeRecordingRecord(record: RecordingRecord): Uint8Array {
	const json = Match.value(record).pipe(
		Match.when({ kind: "header" }, (header) =>
			JSON.stringify({
				kind: "header",
				format: header.format,
				version: header.version,
				profile: header.profile,
				provenance: header.provenance,
				redactionVersion: header.redactionVersion,
			}),
		),
		Match.when({ kind: "chunk" }, (chunk) =>
			JSON.stringify({
				kind: "chunk",
				packetSeq: chunk.packetSeq,
				offsetMs: chunk.offsetMs,
				stream: chunk.stream,
				base64: chunk.base64,
			}),
		),
		Match.when({ kind: "end" }, (end) =>
			JSON.stringify({
				kind: "end",
				chunks: end.chunks,
				outcome: end.outcome,
				error: end.error,
			}),
		),
		Match.exhaustive,
	);

	return Buffer.from(`${json}\n`, "utf8");
}

export function chunkFromPacket(packet: SourcePacket): Extract<RecordingRecord, { kind: "chunk" }> {
	return {
		kind: "chunk",
		packetSeq: packet.packetSeq,
		offsetMs: packet.offsetMs,
		stream: packet.stream,
		base64: encodeBase64(packet.bytes),
	};
}

export function validateRecordingSequence(
	state: RecordingSequenceState,
	record: RecordingRecord,
): Result<RecordingSequenceState, RecordingError> {
	if (state.ended) {
		return err(invalidRecording("trailing record after footer"));
	}

	return Match.value(record).pipe(
		Match.when({ kind: "header" }, (header) => validateHeader(state, header)),
		Match.when({ kind: "chunk" }, (chunk) => validateChunk(state, chunk)),
		Match.when({ kind: "end" }, (end) => validateEnd(state, end)),
		Match.exhaustive,
	);
}

function validateHeader(
	state: RecordingSequenceState,
	_header: RecordingHeader,
): Result<RecordingSequenceState, RecordingError> {
	if (state.headerSeen) return err(invalidRecording("duplicate header"));

	return ok({
		...state,
		headerSeen: true,
	});
}

function validateChunk(
	state: RecordingSequenceState,
	chunk: Extract<RecordingRecord, { kind: "chunk" }>,
): Result<RecordingSequenceState, RecordingError> {
	if (!state.headerSeen) return err(invalidRecording("chunk before header"));

	if (chunk.packetSeq !== state.expectedPacketSeq) {
		return err(invalidRecording(`expected packetSeq ${state.expectedPacketSeq}`));
	}

	if (chunk.offsetMs < state.lastOffsetMs) {
		return err(invalidRecording("offsets must be nondecreasing"));
	}

	const bytes = decodeBase64Strict(chunk.base64);

	if (!bytes.ok) return bytes;

	return ok({
		...state,
		expectedPacketSeq: state.expectedPacketSeq + 1,
		lastOffsetMs: chunk.offsetMs,
	});
}

function validateEnd(
	state: RecordingSequenceState,
	end: Extract<RecordingRecord, { kind: "end" }>,
): Result<RecordingSequenceState, RecordingError> {
	if (!state.headerSeen) return err(invalidRecording("footer before header"));

	if (end.chunks !== state.expectedPacketSeq) {
		return err(invalidRecording("footer chunk count does not match"));
	}

	if (end.outcome === "source-failure" && end.error === null) {
		return err(invalidRecording("source-failure footer requires an error"));
	}

	if (end.outcome !== "source-failure" && end.error !== null) {
		return err(invalidRecording("only source-failure carries an error"));
	}

	return ok({
		...state,
		ended: true,
	});
}

export function sourceErrorMessage(error: SourceError): string {
	return error.message;
}

export const bytesToBase64 = encodeBase64;

export const base64ToBytes = decodeBase64Strict;

export const RECORDING_PROFILE = "threadtime-epoch-usec-v1" as const;

export function syntheticRecordingHeader(): RecordingHeader {
	return {
		kind: "header",
		format: "logview-recording",
		version: 1,
		profile: RECORDING_PROFILE,
		provenance: "synthetic",
		redactionVersion: null,
	};
}

export const SANITIZED_REDACTION_VERSION = "2026-09-18.public-aosp-pattern.v1";

export function sanitizedRecordingHeader(): RecordingHeader {
	return {
		kind: "header",
		format: "logview-recording",
		version: 1,
		profile: RECORDING_PROFILE,
		provenance: "sanitized-real",
		redactionVersion: SANITIZED_REDACTION_VERSION,
	};
}

export function recordingError(
	kind: RecordingError["kind"],
	message: string,
	line?: number,
): RecordingError {
	return line === undefined ? { kind, message } : { kind, message, line };
}
