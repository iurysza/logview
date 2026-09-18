import { describe, expect, test } from "bun:test";
import { VisibleIndexStore } from "@logview/engine";

describe("visible index", () => {
	test("appends, locates, windows, and prunes by retained prefix", () => {
		const index = new VisibleIndexStore();
		index.append([1, 2, 3, 4, 5]);
		expect(index.size).toBe(5);
		expect(index.locate(3)).toEqual({ exactRank: 2, nextRank: 3, previousRank: 1 });
		expect(index.window(1, 3)).toEqual([2, 3, 4]);
		index.pruneBefore(3);
		expect(index.snapshotIds()).toEqual([3, 4, 5]);
		expect(index.locate(2)).toEqual({ exactRank: null, nextRank: 0, previousRank: null });
		index.insert(6);
		expect(index.snapshotIds()).toEqual([3, 4, 5, 6]);
		expect(index.remove(4)).toBe(true);
		expect(index.snapshotIds()).toEqual([3, 5, 6]);
		expect(index.remove(9)).toBe(false);
	});
});
