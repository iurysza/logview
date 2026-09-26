import { messageText, sanitizeDisplay, tagText, type LogEvent } from "@logcayo/core";

function formatDateTime(epochMicros: number): string {
	return new Date(Math.floor(epochMicros / 1000)).toISOString().replace("T", " ").replace("Z", "");
}

function formatContinuation(line: string): string {
	const content = line.startsWith("\t") ? line.slice(1) : line;

	return `    ${sanitizeDisplay(content)}`;
}

/** Formats an event for a readable, complete, colour-free clipboard entry. */
export function formatClipboardEvent(event: LogEvent): string {
	if (!event.metadata) {
		return [sanitizeDisplay(event.rawText), ...event.continuations.map(formatContinuation)].join("\n");
	}

	const { metadata } = event;

	const header = [
		formatDateTime(metadata.epochMicros),
		metadata.level,
		`${metadata.pid}:${metadata.tid}`,
		tagText(event.rawText, metadata.tag),
	].join(" ");

	const message = sanitizeDisplay(messageText(event.rawText, metadata.message));
	const continuations = event.continuations.map(formatContinuation);

	return [header, message, ...continuations].join("\n");
}

/** Writes text using macOS's standard clipboard command without shell interpolation. */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		const process = Bun.spawn(["pbcopy"], {
			stdin: new Blob([text]),
			stdout: "ignore",
			stderr: "ignore",
		});

		return (await process.exited) === 0;
	} catch {
		return false;
	}
}
