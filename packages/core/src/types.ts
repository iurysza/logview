import { Either } from "effect";

export type Result<T, E> =
	| { ok: true; value: T }
	| { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

export function eitherToResult<A, E>(either: Either.Either<A, E>): Result<A, E> {
	return Either.match(either, {
		onLeft: (error) => err(error),
		onRight: (value) => ok(value),
	});
}

export function resultToEither<A, E>(result: Result<A, E>): Either.Either<A, E> {
	return result.ok ? Either.right(result.value) : Either.left(result.error);
}

export type SessionId = string;

export type EventId = number;

export type FilterRevision = number;

export type LogLevel = "V" | "D" | "I" | "W" | "E" | "F";

export type TextSlice = Readonly<{ start: number; end: number }>;

export const LOG_LEVELS: readonly LogLevel[] = ["V", "D", "I", "W", "E", "F"];

export function isLogLevel(value: string): value is LogLevel {
	return value === "V" || value === "D" || value === "I" || value === "W" || value === "E" || value === "F";
}

export function levelRank(level: LogLevel): number {
	return LOG_LEVELS.indexOf(level);
}

export type LogMetadata = Readonly<{
	epochMicros: number;
	pid: number;
	tid: number;
	level: LogLevel;
	tag: TextSlice;
	message: TextSlice;
}>;

export type SourceKind = "live" | "replay";

export type LogEvent = Readonly<{
	id: EventId;
	sourceOffsetMs: number;
	rawText: string;
	metadata: LogMetadata | null;
	continuations: readonly string[];
	endedWithLf: boolean;
	omittedBytes: number;
	invalidUtf8: boolean;
	chargeBytes: number;
}>;

export type FilterSpec = Readonly<{
	minLevel: LogLevel | null;
	tag: string | null;
	pid: number | null;
	text: string;
}>;

export type PreparedFilter = Readonly<{
	spec: FilterSpec;
	foldedText: string;
}>;

export type ViewState = Readonly<{
	mode: "tail" | "browse";
	topId: EventId | null;
	selectedId: EventId | null;
	newSincePause: number;
}>;

export const EMPTY_FILTER: FilterSpec = {
	minLevel: null,
	tag: null,
	pid: null,
	text: "",
};

export const EMPTY_VIEW: ViewState = {
	mode: "tail",
	topId: null,
	selectedId: null,
	newSincePause: 0,
};

export const EVENT_CHARGE_OVERHEAD = 192;

export const MAX_FIELD_CODE_POINTS = 256;

export const MAX_PACKET_BYTES = 64 * 1024;

export const MAX_LINE_BYTES = 64 * 1024;

export const MAX_RECORDING_LINE_BYTES = 128 * 1024;

export const DEFAULT_MAX_EVENTS = 100_000;

export const DEFAULT_MAX_HISTORY_CHARGE_BYTES = 64 * 1024 * 1024;

export const DEFAULT_MAX_QUEUED_BYTES = 4 * 1024 * 1024;

export const DEFAULT_WORK_SLICE_MS = 4;

export const DEFAULT_MAX_LINES_PER_SLICE = 256;

export const MAX_DECODED_SLICE_BYTES = 512 * 1024;

export const MAX_SOURCE_NOTICES = 16;

export const MAX_NOTICE_MESSAGE_BYTES = 2 * 1024;

export const MIN_TERMINAL_COLUMNS = 40;

export const MIN_TERMINAL_ROWS = 8;

export const CHROME_ROWS = 6;

export function eventChargeBytes(rawText: string, continuations: readonly string[] = []): number {
	let chars = rawText.length;

	for (const line of continuations) chars += line.length;

	return EVENT_CHARGE_OVERHEAD + 2 * chars;
}

export function codePointCount(value: string): number {
	return [...value].length;
}
