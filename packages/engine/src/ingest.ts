import { emptyFramerState, frameBytes, type FramerState, type FramedLine } from "@logview/core";
import { MAX_PACKET_BYTES } from "@logview/core";
import type { SourcePacket } from "./ports.ts";

export type QueuePacket = {
	bytes: Uint8Array;
	offsetMs: number;
	packetSeq: number;
	cursor: number;
};

export class IngestQueue {
	private readonly packets: QueuePacket[] = [];
	queuedBytes = 0;

	enqueue(packet: SourcePacket, capacity: number): boolean {
		if (packet.bytes.byteLength > MAX_PACKET_BYTES) return false;

		if (this.queuedBytes + packet.bytes.byteLength > capacity) return false;

		this.packets.push({
			bytes: packet.bytes,
			offsetMs: packet.offsetMs,
			packetSeq: packet.packetSeq,
			cursor: 0,
		});
		this.queuedBytes += packet.bytes.byteLength;

		return true;
	}

	current(): QueuePacket | undefined {
		return this.packets[0];
	}

	consume(count: number): void {
		const packet = this.packets[0];

		if (!packet || count <= 0) return;

		packet.cursor += count;
		this.queuedBytes -= count;

		if (packet.cursor >= packet.bytes.byteLength) {
			this.packets.shift();
		}
	}

	get empty(): boolean {
		return this.packets.length === 0;
	}
}

export type SliceLimits = Readonly<{
	maxLineBytes: number;
	maxLines: number;
	maxDecodedBytes: number;
}>;

export type FrameDrain = Readonly<{
	state: FramerState;
	lines: readonly FramedLine[];
	lastOffsetMs: number | null;
	consumed: boolean;
}>;

const EMPTY_BYTES = new Uint8Array(0);

export function drainFrameSlice(
	state: FramerState,
	queue: IngestQueue,
	eof: boolean,
	limits: SliceLimits,
): FrameDrain {
	const lines: FramedLine[] = [];
	let current = state;
	let lastOffsetMs: number | null = null;
	let decoded = 0;
	let consumed = false;

	while (lines.length < limits.maxLines && decoded < limits.maxDecodedBytes) {
		const packet = queue.current();

		if (!packet) {
			if (!eof) break;

			const step = frameBytes(current, EMPTY_BYTES, {
				eof: true,
				maxLineBytes: limits.maxLineBytes,
				maxLines: limits.maxLines - lines.length,
			});

			current = step.state;

			for (const line of step.lines) {
				lines.push(line);
				decoded += line.bytes.byteLength;
			}

			consumed = consumed || step.lines.length > 0;
			break;
		}

		const remaining = packet.bytes.subarray(packet.cursor);

		const step = frameBytes(current, remaining, {
			eof: false,
			maxLineBytes: limits.maxLineBytes,
			maxLines: limits.maxLines - lines.length,
		});

		if (step.consumedBytes === 0 && step.lines.length === 0) break;

		queue.consume(step.consumedBytes);
		current = step.state;
		consumed = true;

		if (step.lines.length > 0) lastOffsetMs = packet.offsetMs;

		for (const line of step.lines) {
			lines.push(line);
			decoded += line.bytes.byteLength;
		}
	}

	return { state: current, lines, lastOffsetMs, consumed };
}

export { emptyFramerState };
