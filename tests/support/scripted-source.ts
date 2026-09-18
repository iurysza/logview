import type { LogSource, SourceError, SourceEvent, SourcePacket } from "@logview/engine";

export class ScriptedSource implements LogSource {
	readonly maxBufferedBytes = 0;
	private readonly queued: SourceEvent[] = [];
	private readonly waiters: Array<() => void> = [];
	private closed = false;
	private seq = 0;

	push(...events: SourceEvent[]): void {
		for (const event of events) this.queued.push(event);
		this.wake();
	}

	pushLine(text: string, offsetMs: number): void {
		const body = text.endsWith("\n") ? text : `${text}\n`;

		const packet: SourcePacket = {
			kind: "chunk",
			packetSeq: this.seq,
			offsetMs,
			stream: "stdout",
			bytes: new TextEncoder().encode(body),
		};

		this.seq += 1;
		this.push(packet);
	}

	end(): void {
		this.push({ kind: "ended", reason: "eof" });
	}

	fail(error: SourceError): void {
		this.push({ kind: "failed", error });
	}

	async close(): Promise<void> {
		this.closed = true;
		this.wake();
	}

	async *open(signal: AbortSignal): AsyncIterable<SourceEvent> {
		yield { kind: "ready" };

		while (!this.closed && !signal.aborted) {
			if (this.queued.length === 0) {
				await new Promise<void>((resolve) => {
					this.waiters.push(resolve);
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				continue;
			}

			const event = this.queued[0];

			if (!event) continue;

			this.queued.splice(0, 1);
			yield event;

			if (event.kind === "ended" || event.kind === "failed") return;
		}

		yield { kind: "ended", reason: "stopped" };
	}

	private wake(): void {
		const waiters = sourceWaiters(this.waiters);

		for (const waiter of waiters) waiter();
	}
}

function sourceWaiters(waiters: Array<() => void>): Array<() => void> {
	return waiters.splice(0, waiters.length);
}

export function logcatLine(id: number, message: string): string {
	const micros = String(id).padStart(6, "0");

	return `1760000000.${micros}  1234  1250 I Tag: ${message}`;
}

export function stdoutPacket(seq: number, offsetMs: number, line: string): SourcePacket {
	const body = line.endsWith("\n") ? line : `${line}\n`;

	return {
		kind: "chunk",
		packetSeq: seq,
		offsetMs,
		stream: "stdout",
		bytes: new TextEncoder().encode(body),
	};
}
