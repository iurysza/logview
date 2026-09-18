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

	test("down on the last tail row enters browse instead of remaining in tail", () => {
		const plan = planNavigation(
			{ mode: "tail", topId: 4, selectedId: 8, newSincePause: 0 },
			{ kind: "move", delta: 1 },
			{
				count: 8,
				visibleHeight: 5,
				top: { exactRank: 3, nextRank: 4, previousRank: 2 },
				selected: { exactRank: 7, nextRank: null, previousRank: 6 },
				newMatchingArrivals: 0,
			},
		);

		expect(plan.mode).toBe("browse");
		expect(plan.selectedRank).toBe(7);
		expect(plan.newSincePause).toBe(0);
	});

	test("G/End resumes tail on the newest match", () => {
		const plan = planNavigation(
			{ mode: "browse", topId: 4, selectedId: 6, newSincePause: 2 },
			{ kind: "tail" },
			{
				count: 8,
				visibleHeight: 5,
				top: { exactRank: 3, nextRank: 4, previousRank: 2 },
				selected: { exactRank: 5, nextRank: 6, previousRank: 4 },
				newMatchingArrivals: 0,
			},
		);

		expect(plan.mode).toBe("tail");
		expect(plan.selectedRank).toBe(7);
		expect(plan.topRank).toBe(3);
		expect(plan.newSincePause).toBe(0);
	});
});
