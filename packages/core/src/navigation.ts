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

export function keepSelectedVisible(
	topRank: number | null,
	selectedRank: number,
	visibleHeight: number,
	count: number,
): number {
	if (count <= 0) return 0;
	const height = Math.max(1, visibleHeight);
	const lastTop = Math.max(0, count - height);
	let top = topRank ?? clamp(selectedRank - height + 1, 0, lastTop);
	if (selectedRank < top) top = selectedRank;
	if (selectedRank >= top + height) top = selectedRank - height + 1;
	return clamp(top, 0, lastTop);
}

function tailPlan(facts: NavigationFacts): NavigationPlan {
	if (facts.count === 0) {
		return { mode: "tail", topRank: null, selectedRank: null, newSincePause: 0 };
	}
	const selectedRank = facts.count - 1;
	return {
		mode: "tail",
		selectedRank,
		topRank: keepSelectedVisible(null, selectedRank, facts.visibleHeight, facts.count),
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
		topRank: keepSelectedVisible(topHint, selectedRank, facts.visibleHeight, facts.count),
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
	const step = cause.kind === "page" ? Math.max(1, facts.visibleHeight - 1) : 1;
	const current =
		resolveLocation(facts.selected) ?? (state.mode === "tail" ? facts.count - 1 : 0);
	if (state.mode === "tail" && cause.kind === "move" && cause.delta === 1) {
		const selectedRank = facts.count - 1;
		return {
			mode: "browse",
			selectedRank,
			topRank: keepSelectedVisible(facts.top.exactRank, selectedRank, facts.visibleHeight, facts.count),
			newSincePause: 0,
		};
	}
	const selectedRank = clamp(current + cause.delta * step, 0, facts.count - 1);
	const newSincePause = state.mode === "tail" ? 0 : state.newSincePause;
	return {
		mode: "browse",
		selectedRank,
		topRank: keepSelectedVisible(
			facts.top.exactRank,
			selectedRank,
			facts.visibleHeight,
			facts.count,
		),
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
					topRank: keepSelectedVisible(
						facts.top.exactRank,
						selectedRank,
						facts.visibleHeight,
						facts.count,
					),
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
