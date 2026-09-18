export type FramerState = Readonly<{
	parts: readonly Uint8Array[];
	retainedBytes: number;
	omittedBytes: number;
}>;

export type FramedLine = Readonly<{
	bytes: Uint8Array;
	endedWithLf: boolean;
	omittedBytes: number;
}>;

export type FrameStep = Readonly<{
	state: FramerState;
	consumedBytes: number;
	lines: readonly FramedLine[];
}>;

export function emptyFramerState(): FramerState {
	return { parts: Object.freeze([]), retainedBytes: 0, omittedBytes: 0 };
}

const EMPTY_PARTS: readonly Uint8Array[] = Object.freeze([]);

function copySlice(bytes: Uint8Array, start: number, end: number): Uint8Array {
	return bytes.slice(start, end);
}

function concatParts(parts: readonly Uint8Array[], extra?: Uint8Array): Uint8Array {
	let total = extra?.byteLength ?? 0;
	for (const part of parts) total += part.byteLength;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	if (extra) out.set(extra, offset);
	return out;
}

function stripTrailingCr(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0d) {
		return bytes.subarray(0, bytes.byteLength - 1);
	}
	return bytes;
}

function pushPart(parts: Uint8Array[], incoming: Uint8Array): void {
	if (incoming.byteLength === 0) return;
	const last = parts[parts.length - 1];
	if (last && last.byteLength <= 64 && incoming.byteLength <= 64) {
		const merged = new Uint8Array(last.byteLength + incoming.byteLength);
		merged.set(last, 0);
		merged.set(incoming, last.byteLength);
		parts[parts.length - 1] = merged;
		return;
	}
	parts.push(incoming);
}

export function frameBytes(
	state: FramerState,
	bytes: Uint8Array,
	options: { eof: boolean; maxLineBytes: number; maxLines: number },
): FrameStep {
	const lines: FramedLine[] = [];
	const parts = state.parts.slice();
	let retainedBytes = state.retainedBytes;
	let omittedBytes = state.omittedBytes;
	let consumed = 0;
	const maxLineBytes = options.maxLineBytes;
	const maxLines = options.maxLines;

	const emit = (chunk: Uint8Array, endedWithLf: boolean, omitted: number): void => {
		lines.push({
			bytes: stripTrailingCr(chunk),
			endedWithLf,
			omittedBytes: omitted,
		});
	};

	while (consumed < bytes.byteLength && lines.length < maxLines) {
		const nextNl = bytes.indexOf(0x0a, consumed);
		if (nextNl === -1) break;

		const incoming = bytes.subarray(consumed, nextNl);
		if (omittedBytes > 0) {
			omittedBytes += incoming.byteLength;
			emit(concatParts(parts), true, omittedBytes);
			parts.length = 0;
			retainedBytes = 0;
			omittedBytes = 0;
			consumed = nextNl + 1;
			continue;
		}

		const room = maxLineBytes - retainedBytes;
		if (incoming.byteLength <= room) {
			emit(concatParts(parts, incoming.byteLength === 0 ? undefined : copySlice(incoming, 0, incoming.byteLength)), true, 0);
			parts.length = 0;
			retainedBytes = 0;
			omittedBytes = 0;
			consumed = nextNl + 1;
			continue;
		}

		if (room > 0) {
			pushPart(parts, copySlice(incoming, 0, room));
			retainedBytes += room;
			omittedBytes += incoming.byteLength - room;
		} else {
			omittedBytes += incoming.byteLength;
		}
		emit(concatParts(parts), true, omittedBytes);
		parts.length = 0;
		retainedBytes = 0;
		omittedBytes = 0;
		consumed = nextNl + 1;
	}

	if (lines.length >= maxLines) {
		return {
			state: {
				parts: parts.length === 0 ? EMPTY_PARTS : parts.slice(),
				retainedBytes,
				omittedBytes,
			},
			consumedBytes: consumed,
			lines,
		};
	}

	if (consumed < bytes.byteLength) {
		const rest = bytes.subarray(consumed);
		if (omittedBytes > 0) {
			omittedBytes += rest.byteLength;
			consumed = bytes.byteLength;
		} else {
			const room = maxLineBytes - retainedBytes;
			if (rest.byteLength <= room) {
				pushPart(parts, copySlice(rest, 0, rest.byteLength));
				retainedBytes += rest.byteLength;
				consumed = bytes.byteLength;
			} else {
				if (room > 0) {
					pushPart(parts, copySlice(rest, 0, room));
					retainedBytes += room;
					omittedBytes += rest.byteLength - room;
				} else {
					omittedBytes += rest.byteLength;
				}
				consumed = bytes.byteLength;
			}
		}
	}

	if (options.eof && (parts.length > 0 || omittedBytes > 0) && lines.length < maxLines) {
		emit(concatParts(parts), false, omittedBytes);
		parts.length = 0;
		retainedBytes = 0;
		omittedBytes = 0;
	}

	return {
		state: {
			parts: parts.length === 0 ? EMPTY_PARTS : parts.slice(),
			retainedBytes,
			omittedBytes,
		},
		consumedBytes: consumed,
		lines,
	};
}
