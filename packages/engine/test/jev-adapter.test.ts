import { describe, expect, test } from "bun:test";
import { createJevClassifier } from "@logview/engine";

describe("Jev adapter", () => {
	test("maps a TypeSafe noul batch onto relevance by event ID", async () => {
		const fetchCalls: string[] = [];

		const created = createJevClassifier({
			apiKey: "test-key",
			modelId: "jev-1.13.0",
			fetch: async (input, init) => {
				fetchCalls.push(String(input));

				const raw: unknown = JSON.parse(String(init?.body ?? "{}"));

				// SAFETY: this test supplies the request body as JSON with query, questions, and model.
				const body = raw as {
					state: { query: string };
					questions: { e7?: { type: string }; e9?: { type: string } };
					model: string;
				};

				expect(body.model).toBe("jev-1.13.0");
				expect(body.state.query).toBe("database access");
				expect(body.questions.e7?.type).toBe("noul");
				expect(body.questions.e9?.type).toBe("noul");

				return new Response(
					JSON.stringify({
						model: "jev-1.13.0",
						answers: {
							e7: { type: "noul", noul: 0.88 },
							e9: { type: "noul", noul: 0.12 },
						},
						usage: { input_tokens: 10, output_tokens: 2 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});

		expect(created.ok).toBe(true);

		if (!created.ok) return;

		const result = await created.value.classifyBatch(
			{
				sessionId: "session-1",
				requestId: "req-1",
				query: {
					revision: 3,
					text: "database access",
					threshold: 0.5,
					promptVersion: "log-relevance-noul-v1",
					redactionVersion: "tag-level-message-v1",
				},
				modelId: "jev-1.13.0",
				items: [
					{ eventId: 7, tag: "Database", level: "I", message: "BEGIN TRANSACTION" },
					{ eventId: 9, tag: "Wifi", level: "D", message: "scan complete" },
				],
			},
			new AbortController().signal,
		);

		expect(result.ok).toBe(true);

		if (!result.ok) return;

		expect(result.value.resolvedModelId).toBe("jev-1.13.0");
		expect(result.value.results).toEqual([
			{ eventId: 7, kind: "scored", relevance: 0.88 },
			{ eventId: 9, kind: "scored", relevance: 0.12 },
		]);
		expect(fetchCalls[0]?.includes("/v1/systemone")).toBe(true);
	});

	test("translates abort into a cancelled classifier error", async () => {
		const created = createJevClassifier({
			apiKey: "test-key",
			fetch: async (_input, init) => {
				const signal = init?.signal;

				await new Promise<void>((_, reject) => {
					signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
				});

				return new Response("{}", { status: 200 });
			},
		});

		expect(created.ok).toBe(true);

		if (!created.ok) return;

		const abort = new AbortController();

		const pending = created.value.classifyBatch(
			{
				sessionId: "session-1",
				requestId: "req-2",
				query: {
					revision: 1,
					text: "x",
					threshold: 0.5,
					promptVersion: "log-relevance-noul-v1",
					redactionVersion: "tag-level-message-v1",
				},
				modelId: "jev-1.13.0",
				items: [{ eventId: 1, tag: "T", level: "I", message: "hello" }],
			},
			abort.signal,
		);

		abort.abort();
		const result = await pending;
		expect(result.ok).toBe(false);

		if (result.ok) return;

		expect(result.error.kind).toBe("cancelled");
	});
});
