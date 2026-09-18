export type {
	HeadlessOutput,
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
	syntheticRecordingHeader,
	validateRecordingSequence,
} from "./recording-schema.ts";

export {
	DEFAULT_MAX_RECORDING_BYTES,
	recordSession,
} from "./recorder.ts";

export type { RecordFailure, RecordOptions, RecordOutcome } from "./recorder.ts";

export { createAdbSource, LOGCAT_ARGS } from "./adapters/adb.ts";

export type { AdbSourceOptions } from "./adapters/adb.ts";

export { createReplaySource } from "./adapters/replay.ts";

export type { ReplayOptions } from "./adapters/replay.ts";

export { BunProcessRunner, createProcessRunner } from "./adapters/process.ts";

export { BunRecordingFiles, createRecordingFiles } from "./adapters/recording-files.ts";

export { RealScheduler, createScheduler } from "./adapters/scheduler.ts";

export {
	LogSourceService,
	ProcessRunnerService,
	RecordingFilesService,
	SchedulerService,
} from "./layers.ts";
