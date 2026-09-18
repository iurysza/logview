import { Either } from "effect";

import type { CommandError } from "./commands.ts";
import { tagText } from "./logcat.ts";
import type { FilterSpec, LogEvent, PreparedFilter, Result } from "./types.ts";
import { codePointCount, eitherToResult, isLogLevel, levelRank, MAX_FIELD_CODE_POINTS } from "./types.ts";

export function foldText(value: string): string {
	return value.toLowerCase();
}

function validateFieldLength(
	field: NonNullable<CommandError["field"]>,
	value: string,
): Either.Either<void, CommandError> {
	if (codePointCount(value) > MAX_FIELD_CODE_POINTS) {
		return Either.left({
			kind: "invalid-filter",
			field,
			message: `${field} exceeds ${MAX_FIELD_CODE_POINTS} code points`,
		});
	}

	return Either.void;
}

export function parsePidField(raw: string): Result<number | null, CommandError> {
	return eitherToResult(
		Either.gen(function* () {
			const trimmed = raw.trim();

			if (trimmed.length === 0) return null;

			if (!/^[0-9]+$/.test(trimmed)) {
				return yield* Either.left({
					kind: "invalid-filter" as const,
					field: "pid" as const,
					message: "PID must be a positive integer",
				});
			}

			const pid = Number(trimmed);

			if (!Number.isSafeInteger(pid) || pid < 1) {
				return yield* Either.left({
					kind: "invalid-filter" as const,
					field: "pid" as const,
					message: "PID must be a positive integer",
				});
			}

			return pid;
		}),
	);
}

export function parseLevelField(raw: string): Result<FilterSpec["minLevel"], CommandError> {
	return eitherToResult(
		Either.gen(function* () {
			const trimmed = raw.trim();

			if (trimmed.length === 0 || trimmed.toUpperCase() === "ALL") return null;
			const upper = trimmed.toUpperCase();

			if (trimmed.length === 1 && isLogLevel(upper)) return upper;

			if (isLogLevel(trimmed)) return trimmed;

			return yield* Either.left({
				kind: "invalid-filter" as const,
				field: "minLevel" as const,
				message: "Level must be ALL, V, D, I, W, E, or F",
			});
		}),
	);
}

export function prepareFilter(spec: FilterSpec): Result<PreparedFilter, CommandError> {
	return eitherToResult(
		Either.gen(function* () {
			const tag = spec.tag === null || spec.tag.trim() === "" ? null : spec.tag.trim();
			const text = spec.text;

			if (tag !== null) yield* validateFieldLength("tag", tag);
			yield* validateFieldLength("text", text);

			if (spec.pid !== null && (!Number.isSafeInteger(spec.pid) || spec.pid < 1)) {
				return yield* Either.left({
					kind: "invalid-filter" as const,
					field: "pid" as const,
					message: "PID must be a positive integer",
				});
			}

			if (spec.minLevel !== null && !isLogLevel(spec.minLevel)) {
				return yield* Either.left({
					kind: "invalid-filter" as const,
					field: "minLevel" as const,
					message: "Level must be ALL, V, D, I, W, E, or F",
				});
			}

			return {
				spec: {
					minLevel: spec.minLevel,
					tag,
					pid: spec.pid,
					text,
				},
				foldedText: foldText(text),
			};
		}),
	);
}

export function matches(event: LogEvent, filter: PreparedFilter): boolean {
	const { spec, foldedText } = filter;

	if (spec.minLevel !== null) {
		if (!event.metadata) return false;

		if (levelRank(event.metadata.level) < levelRank(spec.minLevel)) return false;
	}

	if (spec.tag !== null) {
		if (!event.metadata) return false;

		if (tagText(event.rawText, event.metadata.tag) !== spec.tag) return false;
	}

	if (spec.pid !== null) {
		if (!event.metadata) return false;

		if (event.metadata.pid !== spec.pid) return false;
	}

	if (foldedText.length > 0) {
		if (foldText(event.rawText).includes(foldedText)) return true;

		for (const line of event.continuations) {
			if (foldText(line).includes(foldedText)) return true;
		}

		return false;
	}

	return true;
}
