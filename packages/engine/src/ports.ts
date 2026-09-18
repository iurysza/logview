import type { Result } from "@logview/core";

export type SourceError = Readonly<{
	kind:
		| "adb-missing"
		| "no-device"
		| "ambiguous-device"
		| "unauthorized"
		| "device-offline"
		| "unsupported-format"
		| "process-exit"
		| "recording-invalid"
		| "io";
	message: string;
	exitCode?: number;
}>;

export type SourcePacket = Readonly<{
	kind: "chunk";
	packetSeq: number;
	offsetMs: number;
	stream: "stdout" | "stderr";
	bytes: Uint8Array;
}>;

export type SourceTerminal =
	| { kind: "ended"; reason: "eof" | "stopped" }
	| { kind: "failed"; error: SourceError };

export type SourceNotice = Readonly<{
	kind: "notice";
	code: "diagnostic" | "partial-recording" | "capture-size-limit";
	message: string;
}>;

export type SourceEvent = { kind: "ready" } | SourcePacket | SourceNotice | SourceTerminal;

export type SourceStatus =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "running" }
	| SourceTerminal;

export interface LogSource {
	readonly maxBufferedBytes: number;
	open(signal: AbortSignal): AsyncIterable<SourceEvent>;
	close(): Promise<void>;
}

export type Cancel = () => void;

export interface Scheduler {
	nowMs(): number;
	after(delayMs: number, task: () => void): Cancel;
	yield(): Promise<void>;
}

export type ProcessSpec = Readonly<{
	file: string;
	args: readonly string[];
	env: Readonly<Record<string, string>>;
}>;

export type ProcessExit = Readonly<{ code: number | null; signal: string | null }>;

export interface ChildProcessHandle {
	stdout: AsyncIterable<Uint8Array>;
	stderr: AsyncIterable<Uint8Array>;
	exit: Promise<ProcessExit>;
	terminate(graceMs: number): Promise<void>;
}

export interface ProcessRunner {
	spawn(spec: ProcessSpec): Result<ChildProcessHandle, SourceError>;
}

export type RecordingError = Readonly<{
	kind: "exists" | "permission" | "disk-full" | "invalid" | "incomplete-final-line" | "io";
	message: string;
	line?: number;
}>;

export type RecordingHeader = Readonly<{
	kind: "header";
	format: "logview-recording";
	version: 1;
	profile: "threadtime-epoch-usec-v1";
	provenance: "raw-capture" | "sanitized-real" | "synthetic";
	redactionVersion: string | null;
}>;

export type RecordingChunk = Readonly<{
	kind: "chunk";
	packetSeq: number;
	offsetMs: number;
	stream: "stdout" | "stderr";
	base64: string;
}>;

export type RecordingEnd = Readonly<{
	kind: "end";
	chunks: number;
	outcome: "eof" | "user-stop" | "size-limit" | "source-failure";
	error: SourceError | null;
}>;

export type RecordingRecord = RecordingHeader | RecordingChunk | RecordingEnd;

export interface RecordingWriter {
	append(packet: SourcePacket): Promise<Result<void, RecordingError>>;
	finalize(end: RecordingEnd): Promise<Result<void, RecordingError>>;
	abort(): Promise<void>;
}

export interface RecordingFiles {
	create(path: string, header: RecordingHeader): Promise<Result<RecordingWriter, RecordingError>>;
	read(
		path: string,
		signal: AbortSignal,
	): AsyncIterable<Result<RecordingRecord, RecordingError>>;
}

export type AdbSourceOptions = Readonly<{
	adbPath: string;
	serial: string | null;
}>;

export type ReplayOptions = Readonly<{
	path: string;
	speed: { kind: "timed"; multiplier: number } | { kind: "instant" };
	allowPartial: boolean;
}>;

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

export function isSourcePacket(event: SourceEvent): event is SourcePacket {
	return event.kind === "chunk";
}

export function isSourceTerminal(event: SourceEvent | SourceStatus): event is SourceTerminal {
	return event.kind === "ended" || event.kind === "failed";
}
