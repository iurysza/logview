import { SANITIZED_DEVICE_SERIAL, SANITIZED_LOGCAT, SANITIZED_STDERR } from "../../fixtures/real/sanitized-payload.ts";
import { LOGCAT_ARGS } from "@logview/engine";

type StubName =
	| "one-device"
	| "multi-device"
	| "unauthorized"
	| "offline"
	| "no-device"
	| "stderr-flood"
	| "follow";

function isStubName(value: string): value is StubName {
	return (
		value === "one-device" ||
		value === "multi-device" ||
		value === "unauthorized" ||
		value === "offline" ||
		value === "no-device" ||
		value === "stderr-flood" ||
		value === "follow"
	);
}

type ParsedStub = Readonly<{
	stub: StubName;
	rest: string[];
}>;

function readStub(argv: readonly string[]): ParsedStub {
	if (argv[0] === "--stub" && argv[1] && isStubName(argv[1])) {
		return { stub: argv[1], rest: argv.slice(2) };
	}

	return { stub: "one-device", rest: [...argv] };
}

function printDevices(stub: StubName): void {
	process.stdout.write("List of devices attached\n");

	if (stub === "no-device") return;

	if (stub === "multi-device") {
		process.stdout.write("ABCD1234\tdevice\n");
		process.stdout.write("EFGH5678\tdevice\n");

		return;
	}

	if (stub === "unauthorized") {
		process.stdout.write(`${SANITIZED_DEVICE_SERIAL}\tunauthorized\n`);

		return;
	}

	if (stub === "offline") {
		process.stdout.write(`${SANITIZED_DEVICE_SERIAL}\toffline\n`);

		return;
	}

	process.stdout.write(`${SANITIZED_DEVICE_SERIAL}\tdevice\n`);
}

function logcatArgsMatch(args: readonly string[]): boolean {
	const serialIndex = args.indexOf("-s");

	if (serialIndex < 0) return false;

	const command = args.slice(serialIndex + 2);

	if (command.length !== LOGCAT_ARGS.length) return false;

	for (let i = 0; i < LOGCAT_ARGS.length; i += 1) {
		if (command[i] !== LOGCAT_ARGS[i]) return false;
	}

	return true;
}

async function sleepForever(signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolve) => {
		const done = (): void => resolve();
		signal.addEventListener("abort", done, { once: true });
	});
}

async function runLogcat(stub: StubName, args: readonly string[]): Promise<number> {
	if (!logcatArgsMatch(args)) {
		process.stderr.write("fake-adb: capture profile is not threadtime-epoch-usec-v1\n");

		return 2;
	}

	if (stub === "stderr-flood") {
		const chunk = "warn ".repeat(16) + "\n";
		const target = 256 * 1024;
		let written = 0;

		while (written < target) {
			process.stderr.write(chunk);
			written += chunk.length;
		}

		process.stdout.write("1760000100.000001  1234  1250 I Tag: after-stderr\n");

		return 0;
	}

	process.stderr.write(SANITIZED_STDERR);
	process.stdout.write(SANITIZED_LOGCAT);

	if (stub === "follow") {
		await sleepForever(abortFromSignals());

		return 0;
	}

	return 0;
}

function abortFromSignals(): AbortSignal {
	const controller = new AbortController();
	const stop = (): void => controller.abort();
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);

	return controller.signal;
}

async function main(): Promise<number> {
	const parsed = readStub(process.argv.slice(2));

	if (parsed.rest[0] === "devices") {
		printDevices(parsed.stub);

		return 0;
	}

	return runLogcat(parsed.stub, parsed.rest);
}

const code = await main();

process.exitCode = code;
