import { err, ok, type Result } from "@logview/core";
import type { PackageResolver, PackageTable, ProcessRunner, SourceError } from "../ports.ts";

export type AdbPackageResolverOptions = Readonly<{
	adbPath: string;
	serial: string | null;
}>;

export function createAdbPackageResolver(
	options: AdbPackageResolverOptions,
	dependencies: { processes: ProcessRunner },
): PackageResolver {
	return new AdbPackageResolver(options, dependencies);
}

class AdbPackageResolver implements PackageResolver {
	private cached: Promise<Result<PackageTable, SourceError>> | null = null;

	constructor(
		private readonly options: AdbPackageResolverOptions,
		private readonly deps: { processes: ProcessRunner },
	) {}

	load(): Promise<Result<PackageTable, SourceError>> {
		if (this.cached === null) this.cached = this.loadTable();

		return this.cached;
	}

	refresh(): Promise<Result<PackageTable, SourceError>> {
		this.cached = this.loadTable();

		return this.cached;
	}

	private async loadTable(): Promise<Result<PackageTable, SourceError>> {
		const devices = await this.listDevices();

		if (!devices.ok) return devices;

		const serial = selectSerial(devices.value, this.options.serial);

		if (!serial.ok) return serial;

		const spawned = this.deps.processes.spawn({
			file: this.options.adbPath,
			args: ["-s", serial.value, "shell", "cmd", "package", "list", "packages", "-U"],
			env: cleanAdbEnv(),
		});

		if (!spawned.ok) return spawned;

		const [text, _stderr, exit] = await Promise.all([
			readAllText(spawned.value.stdout),
			readAllText(spawned.value.stderr),
			spawned.value.exit,
		]);

		if (exit.code !== 0) {
			return err({
				kind: "process-exit",
				message: `adb package lookup exited with code ${exit.code ?? "null"}`,
				exitCode: exit.code ?? undefined,
			});
		}

		return ok(parsePackageTable(text));
	}

	private async listDevices(): Promise<Result<DeviceRow[], SourceError>> {
		const spawned = this.deps.processes.spawn({
			file: this.options.adbPath,
			args: ["devices"],
			env: cleanAdbEnv(),
		});

		if (!spawned.ok) return spawned;

		const [text, _stderr] = await Promise.all([
			readAllText(spawned.value.stdout),
			readAllText(spawned.value.stderr),
			spawned.value.exit,
		]);

		return ok(parseDevices(text));
	}
}

type DeviceRow = Readonly<{ serial: string; state: string }>;

function selectSerial(devices: readonly DeviceRow[], requested: string | null): Result<string, SourceError> {
	if (requested !== null) {
		const match = devices.find((device) => device.serial === requested);

		if (!match) return err({ kind: "no-device", message: `device ${requested} was not found` });

		if (match.state === "unauthorized") return err({ kind: "unauthorized", message: `device ${requested} is unauthorized` });

		if (match.state !== "device") return err({ kind: "device-offline", message: `device ${requested} is ${match.state}` });

		return ok(requested);
	}

	const usable = devices.filter((device) => device.state === "device");

	if (usable.length === 0) return err({ kind: "no-device", message: "no authorized device is connected" });

	if (usable.length > 1) return err({ kind: "ambiguous-device", message: "more than one authorized device is connected" });

	return ok(usable[0]!.serial);
}

function parseDevices(text: string): DeviceRow[] {
	const rows: DeviceRow[] = [];

	for (const line of text.split(/\r?\n/)) {
		if (line.length === 0 || line.startsWith("List of devices")) continue;
		const [serial, state] = line.split(/\s+/);

		if (serial && state) rows.push({ serial, state });
	}

	return rows;
}

export function parsePackageTable(text: string): PackageTable {
	const packagesByUid = new Map<number, string[]>();

	for (const line of text.split(/\r?\n/)) {
		const match = /^package:([^\s]+)\s+uid:(\d+)$/.exec(line.trim());

		if (!match) continue;
		const packageName = match[1]!;
		const uid = Number(match[2]!);

		if (!Number.isSafeInteger(uid) || uid < 0) continue;
		const packages = packagesByUid.get(uid) ?? [];
		packages.push(packageName);
		packagesByUid.set(uid, packages);
	}

	return [...packagesByUid.entries()]
		.sort(([left], [right]) => left - right)
		.map(([uid, packages]) => ({ uid, packages: packages.sort() }));
}

function cleanAdbEnv() {
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: process.env.HOME ?? "",
	};
}

async function readAllText(stream: AsyncIterable<Uint8Array>): Promise<string> {
	const chunks: Uint8Array[] = [];
	let total = 0;

	for await (const chunk of stream) {
		chunks.push(chunk);
		total += chunk.byteLength;
	}

	const merged = new Uint8Array(total);
	let offset = 0;

	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new TextDecoder().decode(merged);
}
