import type { LogMetadata, TextSlice } from "./types.ts";
import { isLogLevel } from "./types.ts";
import type { FramedLine } from "./framing.ts";

export type ParsedLine =
	| { kind: "control"; control: "blank" | "buffer-marker" }
	| {
			kind: "event";
			rawText: string;
			metadata: LogMetadata | null;
			invalidUtf8: boolean;
	  };

const BUFFER_MARKER = /^-+ beginning of /;

const UID_HEADER =
	/^[ \t]*(\d{1,16})\.(\d{6})[ \t]+(\d{1,10})[ \t]+(\d{1,10})[ \t]+(\d{1,10})[ \t]([VDIWEF])[ \t]([^:]*):(.*)$/;

const LEGACY_HEADER =
	/^[ \t]*(\d{1,16})\.(\d{6})[ \t]+(\d{1,10})[ \t]+(\d{1,10})[ \t]([VDIWEF])[ \t]([^:]*):(.*)$/;

type DecodedText = Readonly<{
	text: string;
	invalidUtf8: boolean;
}>;

const utf8Fatal = new TextDecoder("utf-8", { fatal: true });

const utf8Replace = new TextDecoder("utf-8", { fatal: false });

function decodeUtf8(bytes: Uint8Array): DecodedText {
	try {
		return { text: utf8Fatal.decode(bytes), invalidUtf8: false };
	} catch {
		return { text: utf8Replace.decode(bytes), invalidUtf8: true };
	}
}

function sliceOf(text: string, start: number, end: number): TextSlice {
	return { start, end };
}

function parseMetadata(rawText: string): LogMetadata | null {
	const uidMatch = UID_HEADER.exec(rawText);
	const match = uidMatch ?? LEGACY_HEADER.exec(rawText);

	if (!match) return null;
	const seconds = match[1]!;
	const micros = match[2]!;
	const uidText = uidMatch ? match[3]! : null;
	const pidText = uidMatch ? match[4]! : match[3]!;
	const tidText = uidMatch ? match[5]! : match[4]!;
	const levelText = uidMatch ? match[6]! : match[5]!;
	const tag = uidMatch ? match[7]! : match[6]!;
	const message = uidMatch ? match[8]! : match[7]!;

	if (!isLogLevel(levelText)) return null;

	const secondsNum = Number(seconds);
	const microsNum = Number(micros);

	if (!Number.isSafeInteger(secondsNum) || !Number.isSafeInteger(microsNum)) return null;

	if (secondsNum < 0 || microsNum < 0 || microsNum > 999_999) return null;

	if (secondsNum > Math.floor(Number.MAX_SAFE_INTEGER / 1_000_000)) return null;

	const epochMicros = secondsNum * 1_000_000 + microsNum;

	if (!Number.isSafeInteger(epochMicros)) return null;

	const uid = uidText === null ? null : Number(uidText);
	const pid = Number(pidText);
	const tid = Number(tidText);

	if (uid !== null && (!Number.isSafeInteger(uid) || uid < 0)) return null;

	if (!Number.isSafeInteger(pid) || pid < 0) return null;

	if (!Number.isSafeInteger(tid) || tid < 0) return null;

	const prefixLength = rawText.length - (tag.length + 1 + message.length);
	const tagStart = prefixLength;
	const tagEnd = tagStart + tag.length;
	const messageStart = tagEnd + 1;
	const messageTrimStart = message.startsWith(" ") ? messageStart + 1 : messageStart;

	return {
		epochMicros,
		uid,
		pid,
		tid,
		level: levelText,
		tag: sliceOf(rawText, tagStart, tagEnd),
		message: sliceOf(rawText, messageTrimStart, rawText.length),
	};
}

export function parseLogcatLine(line: FramedLine): ParsedLine {
	const decoded = decodeUtf8(line.bytes);
	const rawText = decoded.text;

	if (rawText.length === 0) {
		return { kind: "control", control: "blank" };
	}

	if (BUFFER_MARKER.test(rawText)) {
		return { kind: "control", control: "buffer-marker" };
	}

	return {
		kind: "event",
		rawText,
		metadata: parseMetadata(rawText),
		invalidUtf8: decoded.invalidUtf8,
	};
}

export function tagText(rawText: string, tag: TextSlice): string {
	return rawText.slice(tag.start, tag.end);
}

export function messageText(rawText: string, message: TextSlice): string {
	return rawText.slice(message.start, message.end);
}
