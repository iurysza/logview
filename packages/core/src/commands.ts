import type { EventId, FilterSpec, LogLevel, Result, SearchMode } from "./types.ts";
import { err, ok } from "./types.ts";

export type SessionCommand =
	| { kind: "move"; delta: -1 | 1 }
	| { kind: "page"; delta: -1 | 1 }
	| { kind: "oldest" }
	| { kind: "tail" }
	| { kind: "toggle-line-display" }
	| { kind: "toggle-search-mode" }
	| { kind: "toggle-below-threshold" }
	| { kind: "request-package-attribution" }
	| { kind: "set-filter"; filter: FilterSpec; searchMode?: SearchMode }
	| { kind: "resize"; columns: number; rows: number };

export type StartError = { kind: "already-started" | "stopped" };

export type ConfigurationError = Readonly<{
	kind: "invalid-options";
	field: string;
	message: string;
}>;

export type CommandError = Readonly<{
	kind: "invalid-filter" | "invalid-size" | "stopped";
	field?: "minLevel" | "tag" | "pid" | "packageName" | "text";
	message: string;
}>;

export type NavigationCause =
	| Extract<SessionCommand, { kind: "move" | "page" | "oldest" | "tail" }>
	| { kind: "arrivals" }
	| { kind: "filter-committed" }
	| { kind: "retention" }
	| { kind: "resize" };

export function validateDimensions(
	columns: number,
	rows: number,
): Result<{ columns: number; rows: number }, CommandError> {
	if (!Number.isSafeInteger(columns) || columns < 1) {
		return err({
			kind: "invalid-size",
			message: "columns must be a positive safe integer",
		});
	}

	if (!Number.isSafeInteger(rows) || rows < 1) {
		return err({
			kind: "invalid-size",
			message: "rows must be a positive safe integer",
		});
	}

	return ok({ columns, rows });
}

export type FilterField = NonNullable<CommandError["field"]>;

export const FILTER_FIELDS: readonly FilterField[] = ["minLevel", "tag", "pid", "packageName", "text"];

export type RowSpan = Readonly<{
	text: string;
	role: "timestamp" | "level" | "pid" | "tag" | "message" | "warning" | "gutter";
}>;

export type RowKind = "header" | "continuation" | "more";

export type ClassificationMark =
	| { kind: "none" }
	| { kind: "unrequested" }
	| { kind: "pending" }
	| { kind: "scored"; relevance: number }
	| { kind: "unknown"; reason: "unsupported" | "too-large" | "failed" | "skipped" };

export const NONE_CLASSIFICATION: ClassificationMark = { kind: "none" };

export type ViewRow = Readonly<{
	id: EventId;
	selected: boolean;
	level: LogLevel | null;
	kind: RowKind;
	spans: readonly RowSpan[];
	clipped: boolean;
	classification: ClassificationMark;
}>;
