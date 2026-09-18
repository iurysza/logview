import { describe, expect, test } from "bun:test";
import { HistoryStore } from "@logview/engine";

function event(id: number, charge = 200) {
	return {
		id,
		sourceOffsetMs: id,
		rawText: `line-${id}`,
		metadata: null,
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
});
