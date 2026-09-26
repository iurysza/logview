import {
	APITimeoutError,
	APIUserAbortError,
	AuthenticationError,
	BadRequestError,
	noul,
	PermissionDeniedError,
	RateLimitError,
	TypeSafeClient,
	TypeSafeError,
	UnprocessableEntityError,
	type Questions,
} from "@typesafe-ai/sdk";
import { err, ok, type ConfigurationError, type Result } from "@logcayo/core";
import type { ClassifierError, ClassifyRequest, LogClassifier, Relevance } from "../semantic/contracts.ts";
import { JEV_MODEL_ID } from "../semantic/contracts.ts";
import { eventKey, relevanceInstructions, RELEVANCE_FALSE, RELEVANCE_TRUE } from "../semantic/prompt.ts";

export const DEFAULT_JEV_TIMEOUT_MS = 30_000;

export type JevClassifierConfig = Readonly<{
	apiKey: string;
	modelId?: string;
	timeoutMs?: number;
	baseURL?: string;
	fetch?: TypeSafeClient["fetch"];
}>;

type LogStateEntry = Readonly<{
	id: string;
	eventId: number;
	level: string | null;
	tag: string | null;
	message: string;
}>;

function mapProviderError(cause: unknown): ClassifierError {
	if (cause instanceof APIUserAbortError) return { kind: "cancelled" };

	if (cause instanceof APITimeoutError) return { kind: "timeout" };

	if (cause instanceof RateLimitError) {
		return { kind: "rate-limited", retryAfterMs: cause.retryAfterMs };
	}

	if (cause instanceof AuthenticationError || cause instanceof PermissionDeniedError) {
		return { kind: "auth" };
	}

	if (cause instanceof UnprocessableEntityError || cause instanceof BadRequestError) {
		return { kind: "invalid-response" };
	}

	return { kind: "unavailable" };
}

function buildQuestions(request: ClassifyRequest): Questions {
	const questions: Questions = {};

	for (const item of request.items) {
		const key = eventKey(item.eventId);
		questions[key] = noul(relevanceInstructions(key), {
			true: RELEVANCE_TRUE,
			false: RELEVANCE_FALSE,
		});
	}

	return questions;
}

function buildLogs(request: ClassifyRequest): LogStateEntry[] {
	const logs: LogStateEntry[] = [];

	for (const item of request.items) {
		logs.push({
			id: eventKey(item.eventId),
			eventId: item.eventId,
			level: item.level,
			tag: item.tag,
			message: item.message,
		});
	}

	return logs;
}

function resultsFromAnswers(
	request: ClassifyRequest,
	answers: { readonly [name: string]: { readonly type: string; readonly noul?: number } },
): Result<readonly Relevance[], ClassifierError> {
	const results: Relevance[] = [];

	for (const item of request.items) {
		const key = eventKey(item.eventId);
		const answer = answers[key];

		if (answer === undefined || answer.type !== "noul" || answer.noul === undefined || !Number.isFinite(answer.noul)) {
			return err({ kind: "invalid-response" });
		}

		results.push({ eventId: item.eventId, kind: "scored", relevance: answer.noul });
	}

	return ok(results);
}

export function createJevClassifier(config: JevClassifierConfig): Result<LogClassifier, ConfigurationError> {
	const modelId = config.modelId ?? JEV_MODEL_ID;

	try {
		const client = new TypeSafeClient({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
			defaultModel: modelId,
			timeout: config.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
			retry: { maxRetries: 0 },
			logLevel: "off",
			fetch: config.fetch,
		});

		const classifier: LogClassifier = {
			async classifyBatch(request, signal) {
				if (request.items.length === 0) {
					return ok({
						sessionId: request.sessionId,
						requestId: request.requestId,
						queryRevision: request.query.revision,
						resolvedModelId: modelId,
						results: [],
					});
				}

				try {
					const response = await client.systemOne(
						{
							state: {
								query: request.query.text,
								logs: buildLogs(request),
							},
							model: request.modelId,
							questions: buildQuestions(request),
						},
						{ signal },
					);

					const parsed = resultsFromAnswers(request, response.answers);

					if (!parsed.ok) return parsed;

					return ok({
						sessionId: request.sessionId,
						requestId: request.requestId,
						queryRevision: request.query.revision,
						resolvedModelId: response.model,
						results: parsed.value,
					});
				} catch (cause) {
					return err(mapProviderError(cause));
				}
			},
		};

		return ok(classifier);
	} catch (cause) {
		const message = cause instanceof TypeSafeError ? cause.message : "failed to create Jev client";

		return err({
			kind: "invalid-options",
			field: "classifier",
			message,
		});
	}
}
