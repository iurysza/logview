import { err, ok, type Result } from "@logview/core";
import type { ClassifyRequest, ClassifyResponse, ClassifierError, Relevance } from "./contracts.ts";

function isFiniteUnitInterval(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validRelevance(item: Relevance, expected: ReadonlySet<number>): boolean {
	if (!expected.has(item.eventId)) return false;

	if (item.kind === "scored") return isFiniteUnitInterval(item.relevance);

	return item.reason === "unsupported" || item.reason === "too-large";
}

export function validateClassifyResponse(
	request: ClassifyRequest,
	response: ClassifyResponse,
): Result<ClassifyResponse, ClassifierError> {
	if (response.sessionId !== request.sessionId) {
		return err({ kind: "invalid-response" });
	}

	if (response.requestId !== request.requestId) {
		return err({ kind: "invalid-response" });
	}

	if (response.queryRevision !== request.query.revision) {
		return err({ kind: "invalid-response" });
	}

	if (response.resolvedModelId.length === 0) {
		return err({ kind: "invalid-response" });
	}

	if (response.results.length !== request.items.length) {
		return err({ kind: "invalid-response" });
	}

	const expected = new Set<number>();

	for (const item of request.items) expected.add(item.eventId);

	const seen = new Set<number>();

	for (const item of response.results) {
		if (!validRelevance(item, expected) || seen.has(item.eventId)) {
			return err({ kind: "invalid-response" });
		}

		seen.add(item.eventId);
	}

	return ok(response);
}

export function encodedRequestBytes(request: ClassifyRequest): number {
	return Buffer.byteLength(JSON.stringify(request), "utf8");
}

export function encodedItemBytes(item: ClassifyRequest["items"][number]): number {
	return Buffer.byteLength(JSON.stringify(item), "utf8");
}
