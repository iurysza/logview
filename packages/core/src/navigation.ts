import { Match } from "effect";

import type { NavigationCause } from "./commands.ts";
import type { EventId, ViewState } from "./types.ts";

export type Location = Readonly<{
	exactRank: number | null;
	nextRank: number | null;
	previousRank: number | null;
}>;

export type NavigationFacts = Readonly<{
	count: number;
	visibleHeight: number;
	rowHeightAt?: (rank: number) => number;
	top: Location;
	selected: Location;
	newMatchingArrivals: number;
}>;

export type NavigationPlan = Readonly<{
	mode: "tail" | "browse";
	topRank: number | null;
	selectedRank: number | null;
	newSincePause: number;
}>;

export const EMPTY_LOCATION: Location = {
	exactRank: null,
	nextRank: null,
	previousRank: null,
};

export function resolveLocation(location: Location): number | null {
	if (location.exactRank !== null) return location.exactRank;

	if (location.nextRank !== null) return location.nextRank;

	if (location.previousRank !== null) return location.previousRank;

	return null;
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) return min;

	if (value > max) return max;

	return value;
}

function rowHeightAt(facts: NavigationFacts, rank: number): number {
	return Math.max(1, facts.rowHeightAt?.(rank) ?? 1);
}

function topForSelection(selectedRank: number, facts: NavigationFacts): number {
	const height = Math.max(1, facts.visibleHeight);
	let top = selectedRank;
	let used = rowHeightAt(facts, selectedRank);

	while (top > 0) {
		const next = rowHeightAt(facts, top - 1);

		if (used + next > height) break;

		top -= 1;
		used += next;
	}

	return top;
}

function selectionIsVisible(topRank: number, selectedRank: number, facts: NavigationFacts): boolean {
	if (selectedRank < topRank) return false;

	const height = Math.max(1, facts.visibleHeight);
	let used = 0;

	for (let rank = topRank; rank <= selectedRank; rank += 1) {
		used += rowHeightAt(facts, rank);

		if (used > height) return false;
	}

	return true;
}

export function keepSelectedVisible(
	topRank: number | null,
	selectedRank: number,
	facts: NavigationFacts,
): number {
	if (facts.count <= 0) return 0;

	const top = topRank === null ? topForSelection(selectedRank, facts) : clamp(topRank, 0, facts.count - 1);

	if (selectionIsVisible(top, selectedRank, facts)) return top;

	return topForSelection(selectedRank, facts);
}

function pageTarget(current: number, delta: -1 | 1, facts: NavigationFacts): number {
	const budget = Math.max(1, facts.visibleHeight - 1);
	let target = current;
	let used = 0;

	while (target + delta >= 0 && target + delta < facts.count) {
		const next = target + delta;
		const nextHeight = rowHeightAt(facts, next);

		if (used > 0 && used + nextHeight > budget) break;

		target = next;
		used += nextHeight;

		if (used >= budget) break;
	}

	return target;
}

function tailPlan(facts: NavigationFacts): NavigationPlan {
	if (facts.count === 0) {
		return { mode: "tail", topRank: null, selectedRank: null, newSincePause: 0 };
	}

	const selectedRank = facts.count - 1;

	return {
		mode: "tail",
		selectedRank,
		topRank: keepSelectedVisible(null, selectedRank, facts),
		newSincePause: 0,
	};
}

function emptyBrowse(newSincePause: number): NavigationPlan {
	return { mode: "browse", topRank: null, selectedRank: null, newSincePause };
}

function browseFromAnchors(
	facts: NavigationFacts,
	newSincePause: number,
	preferFirstIfEmptySelection: boolean,
): NavigationPlan {
	if (facts.count === 0) return emptyBrowse(newSincePause);
	let selectedRank = resolveLocation(facts.selected);

	if (selectedRank === null) {
		selectedRank = preferFirstIfEmptySelection ? 0 : facts.count - 1;
	}

	const topHint = resolveLocation(facts.top);

	return {
		mode: "browse",
		selectedRank,
		topRank: keepSelectedVisible(topHint, selectedRank, facts),
		newSincePause,
	};
}

function planMove(
	state: ViewState,
	cause: Extract<NavigationCause, { kind: "move" | "page" }>,
	facts: NavigationFacts,
): NavigationPlan {
	if (facts.count === 0) {
		return emptyBrowse(state.mode === "tail" ? 0 : state.newSincePause);
	}

	const current =
		resolveLocation(facts.selected) ?? (state.mode === "tail" ? facts.count - 1 : 0);

	if (state.mode === "tail" && cause.kind === "move" && cause.delta === 1) {
		const selectedRank = facts.count - 1;

		return {
			mode: "browse",
			selectedRank,
			topRank: keepSelectedVisible(facts.top.exactRank, selectedRank, facts),
			newSincePause: 0,
		};
	}

	const selectedRank =
		cause.kind === "page"
			? pageTarget(current, cause.delta, facts)
			: clamp(current + cause.delta, 0, facts.count - 1);

	const newSincePause = state.mode === "tail" ? 0 : state.newSincePause;

	const movedAboveViewport =
		cause.kind === "move" &&
		cause.delta === -1 &&
		facts.top.exactRank !== null &&
		selectedRank < facts.top.exactRank;

	return {
		mode: "browse",
		selectedRank,
		topRank: movedAboveViewport
			? selectedRank
			: keepSelectedVisible(facts.top.exactRank, selectedRank, facts),
		newSincePause,
	};
}

export function planNavigation(
	state: ViewState,
	cause: NavigationCause,
	facts: NavigationFacts,
): NavigationPlan {
	return Match.value(cause).pipe(
		Match.discriminatorsExhaustive("kind")({
			tail: () => tailPlan(facts),
			oldest: () => {
				if (facts.count === 0) return emptyBrowse(state.newSincePause);

				return {
					mode: "browse" as const,
					topRank: 0,
					selectedRank: 0,
					newSincePause: state.mode === "tail" ? 0 : state.newSincePause,
				};
			},
			move: (moveCause) => planMove(state, moveCause, facts),
			page: (pageCause) => planMove(state, pageCause, facts),
			arrivals: () => {
				if (state.mode === "tail") return tailPlan(facts);
				const incoming = state.newSincePause + facts.newMatchingArrivals;

				if (facts.count === 0) return emptyBrowse(incoming);
				const hadSelection = state.selectedId !== null;

				return browseFromAnchors(facts, incoming, !hadSelection);
			},
			retention: () => {
				if (state.mode === "tail") return tailPlan(facts);

				if (facts.count === 0) return emptyBrowse(state.newSincePause);

				return browseFromAnchors(facts, state.newSincePause, false);
			},
			"filter-committed": () => {
				if (facts.count === 0) {
					return state.mode === "tail" ? tailPlan(facts) : emptyBrowse(0);
				}

				if (state.mode === "tail") return tailPlan(facts);

				return browseFromAnchors(facts, 0, false);
			},
			resize: () => {
				if (facts.count === 0) {
					return {
						mode: state.mode,
						topRank: null,
						selectedRank: null,
						newSincePause: state.newSincePause,
					};
				}

				if (state.mode === "tail") {
					const plan = tailPlan(facts);

					return { ...plan, newSincePause: 0 };
				}

				const selectedRank = resolveLocation(facts.selected) ?? facts.count - 1;

				return {
					mode: "browse" as const,
					selectedRank,
					topRank: keepSelectedVisible(facts.top.exactRank, selectedRank, facts),
					newSincePause: state.newSincePause,
				};
			},
		}),
	);
}

export function materializeNavigation(
	plan: NavigationPlan,
	ids: { topId: EventId | null; selectedId: EventId | null },
): ViewState {
	return {
		mode: plan.mode,
		topId: ids.topId,
		selectedId: ids.selectedId,
		newSincePause: plan.newSincePause,
	};
}
