import {
	CHROME_ROWS,
	DEFAULT_MAX_EVENTS,
	DEFAULT_MAX_HISTORY_CHARGE_BYTES,
	DEFAULT_MAX_LINES_PER_SLICE,
	DEFAULT_MAX_QUEUED_BYTES,
	DEFAULT_WORK_SLICE_MS,
	EMPTY_FILTER,
	EVENT_CHARGE_OVERHEAD,
	err,
	MAX_LINE_BYTES,
	MAX_PACKET_BYTES,
	ok,
	prepareFilter,
	validateDimensions,
	type CommandError,
	type ConfigurationError,
	type FilterRevision,
	type FilterSpec,
	type Result,
	type SessionCommand,
	type SessionId,
	type StartError,
	type ViewRow,
	type ViewState,
} from "@logview/core";
import type { LogSource, Scheduler, SourceNotice, SourceStatus, SourceTerminal } from "./ports.ts";

export type SessionStats = Readonly<{
	receivedBytes: number;
	admittedEvents: number;
	retainedEvents: number;
	matchedEvents: number;
	evictedEvents: number;
	unparsedEvents: number;
	truncatedEvents: number;
	omittedBytes: number;
	queuedBytes: number;
	chargedHistoryBytes: number;
	lagging: boolean;
	upstreamLoss: "unknown";
}>;

export type SessionSnapshot = Readonly<{
	sessionId: SessionId;
	revision: number;
	source: SourceStatus;
	sourceNotices: readonly SourceNotice[];
	activeFilter: FilterSpec;
	activeFilterRevision: FilterRevision;
	pendingFilter: FilterSpec | null;
	view: ViewState;
	rows: readonly ViewRow[];
	stats: SessionStats;
	notice: "history-expired" | "applying-filter" | "resize-required" | null;
}>;

export type SessionOptions = Readonly<{
	sessionId: SessionId;
	maxEvents: number;
	maxHistoryChargeBytes: number;
	maxQueuedBytes: number;
	maxLineBytes: number;
	workSliceMs: number;
	maxLinesPerSlice: number;
	columns: number;
	rows: number;
	initialFilter: FilterSpec;
}>;

export interface Session {
	start(): Result<void, StartError>;
	dispatch(command: SessionCommand): Result<void, CommandError>;
	snapshot(): SessionSnapshot;
	subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
	readonly sourceDone: Promise<SourceTerminal>;
	stop(): Promise<void>;
}

export type HeadlessOutput = Readonly<{
	version: 1;
	kind: "summary";
	terminal: SourceTerminal;
	snapshot: SessionSnapshot;
}>;

export type UiError = Readonly<{ kind: "setup-failed"; message: string }>;

export interface TerminalAttachment {
	close(): Promise<void>;
}

export type SessionDependencies = Readonly<{
	source: LogSource;
	scheduler: Scheduler;
}>;

export function defaultSessionOptions(
	overrides: Partial<SessionOptions> & Pick<SessionOptions, "sessionId">,
): SessionOptions {
	return {
		maxEvents: DEFAULT_MAX_EVENTS,
		maxHistoryChargeBytes: DEFAULT_MAX_HISTORY_CHARGE_BYTES,
		maxQueuedBytes: DEFAULT_MAX_QUEUED_BYTES,
		maxLineBytes: MAX_LINE_BYTES,
		workSliceMs: DEFAULT_WORK_SLICE_MS,
		maxLinesPerSlice: DEFAULT_MAX_LINES_PER_SLICE,
		columns: 80,
		rows: 24,
		initialFilter: EMPTY_FILTER,
		...overrides,
	};
}

export function validateSessionOptions(
	options: SessionOptions,
	source: LogSource,
): Result<SessionOptions, ConfigurationError> {
	if (options.sessionId.length === 0) {
		return err({
			kind: "invalid-options",
			field: "sessionId",
			message: "sessionId must be a non-empty string",
		});
	}
	if (!Number.isSafeInteger(options.maxEvents) || options.maxEvents < 1) {
		return err({
			kind: "invalid-options",
			field: "maxEvents",
			message: "maxEvents must be a positive safe integer",
		});
	}
	if (!Number.isSafeInteger(options.maxLineBytes) || options.maxLineBytes < 1) {
		return err({
			kind: "invalid-options",
			field: "maxLineBytes",
			message: "maxLineBytes must be a positive safe integer",
		});
	}
	if (options.maxLineBytes > MAX_LINE_BYTES) {
		return err({
			kind: "invalid-options",
			field: "maxLineBytes",
			message: `maxLineBytes cannot exceed ${MAX_LINE_BYTES}`,
		});
	}
	const minCharge = EVENT_CHARGE_OVERHEAD + 2 * options.maxLineBytes;
	if (
		!Number.isFinite(options.maxHistoryChargeBytes) ||
		options.maxHistoryChargeBytes < minCharge ||
		!Number.isSafeInteger(options.maxHistoryChargeBytes)
	) {
		return err({
			kind: "invalid-options",
			field: "maxHistoryChargeBytes",
			message: `maxHistoryChargeBytes must hold at least one maximum-size line (${minCharge} bytes)`,
		});
	}
	if (!Number.isFinite(options.maxQueuedBytes) || options.maxQueuedBytes < 1) {
		return err({
			kind: "invalid-options",
			field: "maxQueuedBytes",
			message: "maxQueuedBytes must be a positive finite number",
		});
	}
	if (!Number.isFinite(source.maxBufferedBytes) || source.maxBufferedBytes < 0) {
		return err({
			kind: "invalid-options",
			field: "source.maxBufferedBytes",
			message: "source reservation must be a non-negative finite number",
		});
	}
	const queueCapacity = options.maxQueuedBytes - source.maxBufferedBytes;
	if (queueCapacity < MAX_PACKET_BYTES) {
		return err({
			kind: "invalid-options",
			field: "maxQueuedBytes",
			message: "source reservation leaves no room for one maximum-size packet",
		});
	}
	if (!Number.isFinite(options.workSliceMs) || options.workSliceMs <= 0) {
		return err({
			kind: "invalid-options",
			field: "workSliceMs",
			message: "workSliceMs must be a positive finite number",
		});
	}
	if (!Number.isSafeInteger(options.maxLinesPerSlice) || options.maxLinesPerSlice < 1) {
		return err({
			kind: "invalid-options",
			field: "maxLinesPerSlice",
			message: "maxLinesPerSlice must be a positive safe integer",
		});
	}
	const dims = validateDimensions(options.columns, options.rows);
	if (!dims.ok) {
		return err({
			kind: "invalid-options",
			field: "columns",
			message: dims.error.message,
		});
	}
	const filter = prepareFilter(options.initialFilter);
	if (!filter.ok) {
		return err({
			kind: "invalid-options",
			field: filter.error.field ?? "initialFilter",
			message: filter.error.message,
		});
	}
	return ok({
		...options,
		initialFilter: filter.value.spec,
	});
}

export function visibleLogRows(rows: number): number {
	return Math.max(0, rows - CHROME_ROWS);
}
