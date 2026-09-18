import type { EventId } from "@logview/core";
import type { Relevance } from "./contracts.ts";

export type Annotation =
	| Relevance
	| { eventId: EventId; kind: "unknown"; reason: "failed" | "skipped" };

export class AnnotationTable {
	private readonly byId = new Map<EventId, Annotation>();

	get(id: EventId): Annotation | undefined {
		return this.byId.get(id);
	}

	set(result: Annotation): void {
		this.byId.set(result.eventId, result);
	}

	clear(): void {
		this.byId.clear();
	}

	pruneBefore(firstRetainedId: EventId | null): void {
		if (firstRetainedId === null) {
			this.byId.clear();

			return;
		}

		for (const id of this.byId.keys()) {
			if (id < firstRetainedId) this.byId.delete(id);
		}
	}

	delete(id: EventId): void {
		this.byId.delete(id);
	}

	marks(): IterableIterator<Annotation> {
		return this.byId.values();
	}
}
