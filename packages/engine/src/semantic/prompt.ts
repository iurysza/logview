export const RELEVANCE_TRUE =
	"The log is about the same topic, error, component, or action as the filter, even when the wording differs";

export const RELEVANCE_FALSE = "The log is unrelated to the developer filter";

export function relevanceInstructions(eventKey: string): string {
	return `Does the Android log at \`logs.${eventKey}\` match the developer filter in \`query\`?`;
}

export function eventKey(eventId: number): string {
	return `e${eventId}`;
}

export function parseEventKey(key: string): number | null {
	if (!key.startsWith("e")) return null;

	const id = Number(key.slice(1));

	if (!Number.isSafeInteger(id) || id < 1) return null;

	return id;
}
