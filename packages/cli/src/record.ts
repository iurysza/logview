import {
	createAdbPackageResolver,
	createAdbSource,
	createProcessRunner,
	createRecordingFiles,
	createScheduler,
	DEFAULT_MAX_RECORDING_BYTES,
	recordSession,
	uidRecordingHeader,
} from "@logview/engine";

export type RecordCommand = Readonly<{
	adbPath: string;
	serial: string | null;
	outPath: string;
	durationSec: number | null;
	maxFileBytes: number;
}>;

export async function runRecord(command: RecordCommand, signal: AbortSignal): Promise<number> {
	const scheduler = createScheduler();

	const processes = createProcessRunner();

	const source = createAdbSource(
		{ adbPath: command.adbPath, serial: command.serial },
		{ processes, scheduler },
	);

	const resolvedPackages = await createAdbPackageResolver(
		{ adbPath: command.adbPath, serial: command.serial },
		{ processes },
	).load();

	const result = await recordSession(
		source,
		{
			outPath: command.outPath,
			durationMs: command.durationSec === null ? null : command.durationSec * 1000,
			maxFileBytes: command.maxFileBytes,
			header: uidRecordingHeader(resolvedPackages.ok ? resolvedPackages.value : null, "raw-capture"),
		},
		{ files: createRecordingFiles(), scheduler },
		signal,
	);

	if (!result.ok) {
		const error = result.error;
		process.stderr.write(`${error.message}\n`);

		if (error.kind === "invalid-options") return 2;

		return 1;
	}

	if (result.value.end.outcome === "size-limit") {
		process.stderr.write("recording stopped at the capture size limit\n");
	}

	return 0;
}

export { DEFAULT_MAX_RECORDING_BYTES };
