import { Context } from "effect";

import type { LogSource, ProcessRunner, RecordingFiles, Scheduler } from "./ports.ts";

export class SchedulerService extends Context.Tag("@logcayo/engine/Scheduler")<
	SchedulerService,
	Scheduler
>() {}

export class LogSourceService extends Context.Tag("@logcayo/engine/LogSource")<
	LogSourceService,
	LogSource
>() {}

export class RecordingFilesService extends Context.Tag("@logcayo/engine/RecordingFiles")<
	RecordingFilesService,
	RecordingFiles
>() {}

export class ProcessRunnerService extends Context.Tag("@logcayo/engine/ProcessRunner")<
	ProcessRunnerService,
	ProcessRunner
>() {}
