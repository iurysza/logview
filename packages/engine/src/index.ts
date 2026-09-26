export type {
	HeadlessOutput,
	PackageAttribution,
	Session,
	SessionDependencies,
	SessionOptions,
	SessionSnapshot,
	SessionStats,
	TerminalAttachment,
	UiError,
} from "./contracts.ts";

export { defaultSessionOptions, validateSessionOptions, visibleLogRows } from "./contracts.ts";

export type {
	Cancel,
	ChildProcessHandle,
	LogSource,
	ProcessExit,
	ProcessRunner,
	ProcessSpec,
	PackageResolver,
	PackageTable,
	PackageTableEntry,
	RecordedPackageTable,
	RecordingChunk,
	RecordingEnd,
	RecordingError,
	RecordingFiles,
	RecordingHeader,
	RecordingRecord,
	RecordingWriter,
	Scheduler,
	SourceError,
	SourceEvent,
	SourceNotice,
	SourcePacket,
	SourceStatus,
	SourceTerminal,
} from "./ports.ts";

export { isSourcePacket, isSourceTerminal } from "./ports.ts";

export { createSession } from "./session.ts";

export { HistoryStore } from "./history.ts";

export type { AppendOutcome, History, HistoryBounds } from "./history.ts";

export { VisibleIndexStore } from "./visible-index.ts";

export type { VisibleIndex } from "./visible-index.ts";

export {
	base64ToBytes,
	bytesToBase64,
	chunkFromPacket,
	decodeRecordingLine,
	decodeRecordingRecord,
	emptyRecordingSequence,
	encodeRecordingRecord,
	packetFromChunk,
	RECORDING_PROFILE,
	UID_RECORDING_PROFILE,
	syntheticRecordingHeader,
	uidRecordingHeader,
	sanitizedRecordingHeader,
	SANITIZED_REDACTION_VERSION,
	validateRecordingSequence,
} from "./recording-schema.ts";

export {
	DEFAULT_MAX_RECORDING_BYTES,
	recordSession,
} from "./recorder.ts";

export type { RecordFailure, RecordOptions, RecordOutcome } from "./recorder.ts";

export { createAdbSource, LOGCAT_ARGS } from "./adapters/adb.ts";

export type { AdbSourceOptions } from "./adapters/adb.ts";

export { createAdbPackageResolver, parsePackageTable } from "./adapters/packages.ts";

export type { AdbPackageResolverOptions } from "./adapters/packages.ts";

export { createReplaySource } from "./adapters/replay.ts";

export type { ReplayOptions } from "./adapters/replay.ts";

export { BunProcessRunner, createProcessRunner } from "./adapters/process.ts";

export { BunRecordingFiles, createRecordingFiles } from "./adapters/recording-files.ts";

export { RealScheduler, createScheduler } from "./adapters/scheduler.ts";

export { createJevClassifier, DEFAULT_JEV_TIMEOUT_MS } from "./adapters/jev.ts";

export type { JevClassifierConfig } from "./adapters/jev.ts";

export {
	LogSourceService,
	ProcessRunnerService,
	RecordingFilesService,
	SchedulerService,
} from "./layers.ts";

export {
	DEFAULT_SEMANTIC_BATCH_ITEMS,
	DEFAULT_SEMANTIC_FLUSH_MS,
	DEFAULT_SEMANTIC_HISTORY_EVENTS,
	DEFAULT_SEMANTIC_MAX_IN_FLIGHT,
	DEFAULT_SEMANTIC_MAX_QUEUED,
	DEFAULT_SEMANTIC_MAX_REQUEST_BYTES,
	DEFAULT_SEMANTIC_THRESHOLD,
	JEV_MODEL_ID,
	PROMPT_VERSION,
	REDACTION_VERSION,
	defaultSemanticOptions,
} from "./semantic/contracts.ts";

export type {
	ClassifierError,
	ClassifierItem,
	ClassifyRequest,
	ClassifyResponse,
	LogClassifier,
	Relevance,
	SemanticOptions,
	SemanticQuery,
	SemanticErrorKind,
	SemanticStats,
} from "./semantic/contracts.ts";

export { validateClassifyResponse } from "./semantic/validate.ts";
