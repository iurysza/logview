import { describe, expect, test } from "bun:test";
import { HistoryStore } from "@logview/engine";

function event(id: number, charge = 200) {
	return {
		id,
		sourceOffsetMs: id,
		rawText: `line-${id}`,
		metadata: null,
		continuations: [],
		endedWithLf: true,
		omittedBytes: 0,
		invalidUtf8: false,
		chargeBytes: charge,
	};
}

describe("history", () => {
	test("evicts the oldest events when count capacity is exceeded", () => {
		const history = new HistoryStore(3, 10_000);
		history.append([event(1), event(2), event(3)]);
		const outcome = history.append([event(4), event(5)]);
		expect(outcome.retainedNewIds).toEqual([4, 5]);
		expect(outcome.evictedCount).toBe(2);
		expect(history.bounds()).toMatchObject({ firstId: 3, lastId: 5, count: 3 });
		expect(history.get(1)).toBeUndefined();
		expect(history.get(3)?.id).toBe(3);
	});

	test("byte charge can evict before count", () => {
		const history = new HistoryStore(10, 450);
		const outcome = history.append([event(1, 200), event(2, 200), event(3, 200)]);
		expect(outcome.evictedCount).toBe(1);
		expect(history.bounds().firstId).toBe(2);
	});

	test("appendContinuation extends the last event without a new id", () => {
		const history = new HistoryStore(10, 10_000);
		history.append([event(1)]);
		const updated = history.appendContinuation(1, "    at Foo.bar(Foo.java:1)", { omittedBytes: 0, invalidUtf8: false });
		expect(updated?.id).toBe(1);
		expect(updated?.continuations).toEqual(["    at Foo.bar(Foo.java:1)"]);
		expect(history.bounds().count).toBe(1);
	});
});
