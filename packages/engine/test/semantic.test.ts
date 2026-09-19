import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@logview/core";
import {
	validateClassifyResponse,
	type ClassifierError,
	type ClassifierItem,
	type ClassifyRequest,
	type ClassifyResponse,
	type LogClassifier,
	type Relevance,
} from "@logview/engine";
import { openScenario, tick } from "../../../tests/support/scenario.ts";

function item(eventId: number, message: string): ClassifierItem {
	return { eventId, tag: "Tag", level: "I", message };
}

function requestOf(ids: readonly number[]): ClassifyRequest {
	const items: ClassifierItem[] = [];

	for (const eventId of ids) items.push(item(eventId, `msg-${eventId}`));

	return {
		sessionId: "s",
		requestId: "r1",
		query: {
			revision: 1,
			text: "database",
			threshold: 0.5,
			promptVersion: "log-relevance-noul-v1",
			redactionVersion: "tag-level-message-v1",
		},
		modelId: "jev-1.13.0",
		items,
	};
}

function scoringClassifier(scoreFor: (eventId: number) => number): LogClassifier {
	return {
		async classifyBatch(request) {
			const results: Relevance[] = [];

			for (const entry of request.items) {
				results.push({ eventId: entry.eventId, kind: "scored", relevance: scoreFor(entry.eventId) });
			}

			return ok({
				sessionId: request.sessionId,
				requestId: request.requestId,
				queryRevision: request.query.revision,
				resolvedModelId: "fake-jev",
				results,
			});
		},
	};
}

class ScriptedClassifier implements LogClassifier {
	readonly pending: Array<{
		request: ClassifyRequest;
		resolve: (result: Result<ClassifyResponse, ClassifierError>) => void;
	}> = [];

	async classifyBatch(request: ClassifyRequest, signal: AbortSignal): Promise<Result<ClassifyResponse, ClassifierError>> {
		return new Promise((resolve) => {
			const finish = (result: Result<ClassifyResponse, ClassifierError>): void => {
				signal.removeEventListener("abort", onAbort);
				resolve(result);
			};

			const onAbort = (): void => {
				let index = -1;

				for (let i = 0; i < this.pending.length; i += 1) {
					if (this.pending[i]?.request === request) index = i;
				}

				if (index >= 0) this.pending.splice(index, 1);

				finish(err({ kind: "cancelled" }));
			};

			if (signal.aborted) {
				onAbort();

				return;
			}

			signal.addEventListener("abort", onAbort);
			this.pending.push({ request, resolve: finish });
		});
	}

	resolveShuffled(scoreFor: (eventId: number) => number): void {
		const batch = this.pending.splice(0, this.pending.length);

		for (const item of batch) {
			const scored: Relevance[] = [];

			for (const entry of item.request.items) {
				scored.push({ eventId: entry.eventId, kind: "scored", relevance: scoreFor(entry.eventId) });
			}

			const results: Relevance[] = [];

			for (let i = scored.length - 1; i >= 0; i -= 1) results.push(scored[i]!);

			item.resolve(
				ok({
					sessionId: item.request.sessionId,
					requestId: item.request.requestId,
					queryRevision: item.request.query.revision,
					resolvedModelId: "fake-jev",
					results,
				}),
			);
		}
	}
}

describe("semantic classification", () => {
	test("validateClassifyResponse rejects missing IDs and out-of-range scores", () => {
		const request = requestOf([1, 2]);

		const valid = validateClassifyResponse(request, {
			sessionId: "s",
			requestId: "r1",
			queryRevision: 1,
			resolvedModelId: "jev-1.13.0",
			results: [
				{ eventId: 2, kind: "scored", relevance: 0.2 },
				{ eventId: 1, kind: "scored", relevance: 0.9 },
			],
		});

		expect(valid.ok).toBe(true);

		const missing = validateClassifyResponse(request, {
			sessionId: "s",
			requestId: "r1",
			queryRevision: 1,
			resolvedModelId: "jev-1.13.0",
			results: [{ eventId: 1, kind: "scored", relevance: 0.9 }],
		});

		expect(missing.ok).toBe(false);
	});

	test("a shuffled batch admits only confirmed high-relevance rows in source order", async () => {
		const ids = Array.from({ length: 20 }, (_, i) => i + 1);
		const keep = new Set([3, 8, 15]);
		const classifier = scoringClassifier((eventId) => (keep.has(eventId) ? 0.91 : 0.05));

		const scenario = await openScenario({
			maxEvents: 50,
			rows: 24,
			columns: 80,
			classifier,
			semantic: { flushDelayMs: 0, maxBatchItems: 100, threshold: 0.5 },
		});

		await scenario.deliver(ids, (id) => ({ message: `event-${id}` }));
		scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "database locks" },
		});

		const snap = await scenario.waitUntil(
			(current) => current.pendingFilter === null && current.semantic !== null && current.semantic.pendingEvents === 0,
		);

		expect(snap.rows.map((row) => row.id)).toEqual([3, 8, 15]);
		expect(snap.stats.matchedEvents).toBe(3);
		expect(snap.stats.retainedEvents).toBe(20);
		expect(snap.semantic?.classifiedEvents).toBe(20);

		await scenario.finish();
		await scenario.session.stop();
	});

	test("a retained candidate stays hidden until classification", async () => {
		const classifier = new ScriptedClassifier();

		const scenario = await openScenario({
			maxEvents: 20,
			rows: 12,
			columns: 80,
			classifier,
			semantic: { flushDelayMs: 0, maxBatchItems: 100, threshold: 0.5 },
		});

		try {
			await scenario.deliver([1, 2]);
			scenario.session.dispatch({
				kind: "set-filter",
				filter: { minLevel: null, tag: null, pid: null, text: "database locks" },
			});
			await tick(scenario.scheduler);

			let snapshot = scenario.session.snapshot();
			expect(snapshot.rows).toEqual([]);
			expect(snapshot.stats.matchedEvents).toBe(0);
			expect(snapshot.semantic?.pendingEvents).toBe(2);

			classifier.resolveShuffled((eventId) => (eventId === 1 ? 0.9 : 0.1));
			snapshot = await scenario.waitUntil((current) => current.stats.matchedEvents === 1);

			expect(snapshot.rows.map((row) => row.id)).toEqual([1]);
			expect(snapshot.rows[0]?.classification).toEqual({ kind: "scored", relevance: 0.9 });
		} finally {
			await scenario.session.stop();
		}
	});

	test("a low-scored live arrival stays hidden and a high-scored arrival appears once", async () => {
		const classifier = new ScriptedClassifier();

		const scenario = await openScenario({
			maxEvents: 20,
			rows: 12,
			columns: 80,
			classifier,
			semantic: { flushDelayMs: 0, maxBatchItems: 100, threshold: 0.5 },
		});

		try {
			await scenario.deliver([1, 2]);
			scenario.session.dispatch({
				kind: "set-filter",
				filter: { minLevel: null, tag: null, pid: null, text: "database locks" },
			});
			await tick(scenario.scheduler);
			classifier.resolveShuffled(() => 0.9);
			await scenario.waitUntil((current) => current.stats.matchedEvents === 2);

			await scenario.deliver([3, 4]);
			await tick(scenario.scheduler);

			let snapshot = scenario.session.snapshot();
			expect(snapshot.rows.map((row) => row.id)).toEqual([1, 2]);
			expect(snapshot.semantic?.pendingEvents).toBe(2);

			classifier.resolveShuffled((eventId) => (eventId === 4 ? 0.9 : 0.1));
			snapshot = await scenario.waitUntil((current) => current.stats.matchedEvents === 3);

			expect(snapshot.rows.map((row) => row.id)).toEqual([1, 2, 4]);
			expect(snapshot.rows.filter((row) => row.id === 4)).toHaveLength(1);
			expect(snapshot.rows.some((row) => row.id === 3)).toBe(false);
		} finally {
			await scenario.session.stop();
		}
	});

	test("a failed batch records failure without admitting its candidates", async () => {
		const classifier = new ScriptedClassifier();

		const scenario = await openScenario({
			maxEvents: 10,
			rows: 12,
			columns: 80,
			classifier,
			semantic: { flushDelayMs: 0, maxBatchItems: 1, threshold: 0.5 },
		});

		try {
			await scenario.deliver([1]);
			scenario.session.dispatch({
				kind: "set-filter",
				filter: { minLevel: null, tag: null, pid: null, text: "database locks" },
			});
			await tick(scenario.scheduler);
			classifier.pending[0]?.resolve(err({ kind: "auth" }));

			const snapshot = await scenario.waitUntil((current) => current.semantic?.failedEvents === 1);

			expect(snapshot.rows).toEqual([]);
			expect(snapshot.stats.matchedEvents).toBe(0);
			expect(snapshot.semantic?.pendingEvents).toBe(0);
		} finally {
			await scenario.session.stop();
		}
	});

	test("a later query ignores a late response from the previous query", async () => {
		const classifier = new ScriptedClassifier();

		const scenario = await openScenario({
			maxEvents: 20,
			rows: 12,
			columns: 80,
			classifier,
			semantic: { flushDelayMs: 0, maxBatchItems: 10, threshold: 0.5 },
		});

		await scenario.deliver([1, 2, 3, 4], (id) => ({ message: `event-${id}` }));
		scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "query-a" },
		});
		await tick(scenario.scheduler);
		expect(classifier.pending.length).toBeGreaterThan(0);

		const first = classifier.pending[0]!;

		scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "query-b" },
		});
		await tick(scenario.scheduler);

		const lowResults: Relevance[] = [];

		for (const entry of first.request.items) {
			lowResults.push({ eventId: entry.eventId, kind: "scored", relevance: 0.01 });
		}

		first.resolve(
			ok({
				sessionId: first.request.sessionId,
				requestId: first.request.requestId,
				queryRevision: first.request.query.revision,
				resolvedModelId: "fake-jev",
				results: lowResults,
			}),
		);
		await tick(scenario.scheduler);

		classifier.resolveShuffled((eventId) => (eventId === 2 || eventId === 4 ? 0.9 : 0.01));

		const snap = await scenario.waitUntil(
			(current) => current.pendingFilter === null && current.semantic !== null && current.semantic.pendingEvents === 0,
		);

		expect(snap.activeFilter.text).toBe("query-b");
		expect(snap.rows.map((row) => row.id)).toEqual([2, 4]);

		await scenario.session.stop();
	});

	test("a full queue marks extra IDs skipped without stopping ingestion", async () => {
		const classifier = new ScriptedClassifier();

		const scenario = await openScenario({
			maxEvents: 50,
			rows: 12,
			columns: 80,
			classifier,
			semantic: { flushDelayMs: 10_000, maxBatchItems: 2, maxQueuedIds: 3, threshold: 0.5 },
		});

		await scenario.deliver([1, 2, 3, 4, 5, 6], (id) => ({ message: `event-${id}` }));
		scenario.session.dispatch({
			kind: "set-filter",
			filter: { minLevel: null, tag: null, pid: null, text: "noise" },
		});
		await tick(scenario.scheduler);

		const snap = scenario.session.snapshot();
		expect(snap.stats.admittedEvents).toBe(6);
		expect(snap.stats.retainedEvents).toBe(6);
		expect(snap.semantic?.skippedEvents ?? 0).toBeGreaterThan(0);
		expect(snap.stats.matchedEvents).toBe(0);

		await scenario.session.stop();
	});
});
