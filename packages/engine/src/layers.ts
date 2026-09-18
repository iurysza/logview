import { Context } from "effect";

import type { LogSource, ProcessRunner, RecordingFiles, Scheduler } from "./ports.ts";

export class SchedulerService extends Context.Tag("@logview/engine/Scheduler")<
	SchedulerService,
	Scheduler
>() {}

export class LogSourceService extends Context.Tag("@logview/engine/LogSource")<
	LogSourceService,
	LogSource
>() {}

export class RecordingFilesService extends Context.Tag("@logview/engine/RecordingFiles")<
	RecordingFilesService,
	RecordingFiles
>() {}

export class ProcessRunnerService extends Context.Tag("@logview/engine/ProcessRunner")<
	ProcessRunnerService,
	ProcessRunner
>() {}
