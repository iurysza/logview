import { describe, expect, test } from "bun:test";
import { EMPTY_LOCATION, EMPTY_VIEW, planNavigation } from "@logview/core";

describe("navigation", () => {
	test("tail arrivals select the newest event", () => {
		const plan = planNavigation(EMPTY_VIEW, { kind: "arrivals" }, {
			count: 8,
			visibleHeight: 5,
			top: EMPTY_LOCATION,
			selected: EMPTY_LOCATION,
			newMatchingArrivals: 8,
		});
		expect(plan.mode).toBe("tail");
		expect(plan.selectedRank).toBe(7);
		expect(plan.topRank).toBe(3);
	});

	test("moving up enters browse and keeps the selection after later arrivals", () => {
		const afterMove = planNavigation(
			{ mode: "tail", topId: 4, selectedId: 8, newSincePause: 0 },
			{ kind: "move", delta: -1 },
			{
				count: 8,
				visibleHeight: 5,
				top: { exactRank: 3, nextRank: 4, previousRank: 2 },
				selected: { exactRank: 7, nextRank: null, previousRank: 6 },
				newMatchingArrivals: 0,
			},
		);
		expect(afterMove.mode).toBe("browse");
		expect(afterMove.selectedRank).toBe(6);
	});
});
