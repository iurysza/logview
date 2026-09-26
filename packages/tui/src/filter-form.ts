import { LIST_FOCUS, reduceInteraction, type FilterSpec, type InteractionInput, type InteractionState } from "@logcayo/core";

export function createFilterForm(activeFilter: FilterSpec): InteractionState {
	return reduceInteraction(LIST_FOCUS, { kind: "key", key: "f", ctrl: false, shift: false }, activeFilter).state;
}

export function applyFilterInput(
	state: InteractionState,
	input: InteractionInput,
	activeFilter: FilterSpec,
): ReturnType<typeof reduceInteraction> {
	return reduceInteraction(state, input, activeFilter);
}
