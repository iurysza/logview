import { messageText, tagText, type LogEvent } from "@logcayo/core";
import type { ClassifierItem } from "./contracts.ts";

export function classifierItemFromEvent(event: LogEvent): ClassifierItem {
	const parts: string[] = [];

	if (event.metadata) {
		parts.push(messageText(event.rawText, event.metadata.message).trim());
	} else {
		parts.push(event.rawText);
	}

	for (const line of event.continuations) parts.push(line);

	const messageParts: string[] = [];

	for (const part of parts) {
		if (part.length > 0) messageParts.push(part);
	}

	return {
		eventId: event.id,
		tag: event.metadata ? tagText(event.rawText, event.metadata.tag) : null,
		level: event.metadata?.level ?? null,
		message: messageParts.join("\n"),
	};
}
