#!/usr/bin/env bun

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTerminalControl, TERMCTRL_VERSION } from "../../../packages/tui/test/support/ui-capture.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = "tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl";

function bunMeetsMinimum(version: string): boolean {
	const match = /^(\d+)\.(\d+)/.exec(version);

	if (!match) return false;

	const major = Number(match[1]);
	const minor = Number(match[2]);

	return major > 1 || (major === 1 && minor >= 4);
}

async function main(): Promise<void> {
	if (!bunMeetsMinimum(Bun.version)) {
		throw new Error(`Bun ${Bun.version} is below the README requirement of 1.4+`);
	}

	const fixturePath = resolve(repoRoot, fixture);

	if (!(await Bun.file(fixturePath).exists())) {
		throw new Error(`missing replay fixture ${fixture}`);
	}

	const tool = await resolveTerminalControl(repoRoot);

	if (tool.version !== TERMCTRL_VERSION) {
		throw new Error(`pinned Terminal Control is ${TERMCTRL_VERSION}, doctor saw ${tool.version}`);
	}

	process.stdout.write(
		[
			"verify-logview doctor",
			`bun: ${Bun.version}`,
			`termctrl: ${tool.version} at ${tool.binary}`,
			`fixture: ${fixture}`,
			"ok",
			"",
		].join("\n"),
	);
}

main().catch((cause) => {
	process.stderr.write(`${cause instanceof Error ? cause.message : "doctor failed"}\n`);
	process.exitCode = 1;
});
