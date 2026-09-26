export type {
	ConfigurationError,
	CommandError,
	FilterField,
	ClassificationMark,
	NavigationCause,
	RowKind,
	RowSpan,
	SessionCommand,
	StartError,
	ViewRow,
} from "./commands.ts";

export { FILTER_FIELDS, NONE_CLASSIFICATION, validateDimensions } from "./commands.ts";

export {
	clipToWidth,
	containsControlBytes,
	displayWidth,
	escapeCodePoint,
	escapeDisplayText,
	padToWidth,
	sanitizeDisplay,
	TAB_STOP,
} from "./display-text.ts";

export type { ClippedText, EscapedUnit } from "./display-text.ts";

export {
	EMPTY_FILTER,
	EMPTY_VIEW,
	eitherToResult,
	err,
	eventChargeBytes,
	isLogLevel,
	levelRank,
	ok,
	resultToEither,
} from "./types.ts";

export type {
	EventId,
	FilterRevision,
	FilterSpec,
	LineDisplay,
	LogEvent,
	LogLevel,
	LogMetadata,
	PreparedFilter,
	Result,
	SearchMode,
	SessionId,
	SourceKind,
	TextSlice,
	ViewState,
} from "./types.ts";

export {
	CHROME_ROWS,
	DEFAULT_MAX_EVENTS,
	DEFAULT_MAX_HISTORY_CHARGE_BYTES,
	DEFAULT_MAX_LINES_PER_SLICE,
	DEFAULT_MAX_QUEUED_BYTES,
	DEFAULT_WORK_SLICE_MS,
	EVENT_CHARGE_OVERHEAD,
	LOG_LEVELS,
	MAX_DECODED_SLICE_BYTES,
	MAX_FIELD_CODE_POINTS,
	MAX_LINE_BYTES,
	MAX_NOTICE_MESSAGE_BYTES,
	MAX_PACKET_BYTES,
	MAX_RECORDING_LINE_BYTES,
	MAX_SOURCE_NOTICES,
	MIN_TERMINAL_COLUMNS,
	MIN_TERMINAL_ROWS,
	codePointCount,
} from "./types.ts";

export { emptyFramerState, frameBytes } from "./framing.ts";

export type { FrameStep, FramedLine, FramerState } from "./framing.ts";

export { foldText, matches, matchesLocal, parseLevelField, parsePidField, prepareFilter } from "./filters.ts";

export { formatFilterQuery, parseFilterQuery, QUERY_KEYS, textMatchRanges } from "./query.ts";

export type { QueryError } from "./query.ts";

export { LIST_FOCUS, INSPECT_FOCUS, HELP_FOCUS, EMPTY_SELECTION, reduceInteraction } from "./interaction.ts";

export type { InteractionEffect, InteractionInput, InteractionResult, InteractionSelection, InteractionState } from "./interaction.ts";

export { parseLogcatLine, messageText, tagText } from "./logcat.ts";

export type { ParsedLine } from "./logcat.ts";

export {
	EMPTY_LOCATION,
	keepSelectedVisible,
	materializeNavigation,
	planNavigation,
	resolveLocation,
} from "./navigation.ts";

export type { Location, NavigationFacts, NavigationPlan } from "./navigation.ts";

export {
	classificationColumnLayout,
	eventScreenRows,
	fitRow,
	formatTimestamp,
	layoutColumns,
	logViewportHeight,
	markerFor,
	MARKER_IDLE,
	MARKER_PENDING,
	MARKER_SELECTED,
	MARKER_WIDTH,
	MAX_LIST_CONTINUATIONS,
	projectColumnHeader,
	projectEventRows,
	projectRows,
	requiresResize,
	rowDisplayText,
	rowText,
} from "./projection.ts";

export type { ClassificationColumnLayout, ColumnLayout, ProcessColumn } from "./projection.ts";
