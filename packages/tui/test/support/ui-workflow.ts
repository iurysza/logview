import { join } from "node:path";
import { baselinePath, compareBaseline, updateBaseline, writeFailureEvidence } from "./ui-baseline.ts";
import { runUiScenario, type ScenarioRun, type UiScenarioName } from "./ui-scenarios.ts";

export const UI_BASELINE_DIRECTORY = "packages/tui/test/baselines";

export async function verifyUiScenario(options: {
	cwd: string;
	scenario: UiScenarioName;
	outDirectory: string;
	baselineDirectory?: string;
}): Promise<ScenarioRun> {
	const result = await runUiScenario(options);
	const baselineDirectory = join(options.cwd, options.baselineDirectory ?? UI_BASELINE_DIRECTORY);
	const failures: string[] = [];

	for (const checkpoint of result.captures) {
		const path = baselinePath(baselineDirectory, result.scenario, checkpoint.checkpoint);
		const comparison = await compareBaseline(path, checkpoint.capture.snapshot);

		if (comparison.kind === "match") continue;

		const evidenceDirectory = join(options.outDirectory, checkpoint.checkpoint);
		await writeFailureEvidence({
			directory: evidenceDirectory,
			comparison,
			actual: checkpoint.capture.snapshot,
		});
		failures.push(`${comparison.message}\nEvidence: ${evidenceDirectory}`);
	}

	if (failures.length > 0) {
		throw new Error(`UI scenario ${result.scenario} failed baseline verification:\n${failures.join("\n\n")}`);
	}

	return result;
}

export async function updateUiScenarioBaselines(options: {
	cwd: string;
	scenario: UiScenarioName;
	outDirectory: string;
	baselineDirectory?: string;
}): Promise<ScenarioRun> {
	const result = await runUiScenario(options);
	const baselineDirectory = join(options.cwd, options.baselineDirectory ?? UI_BASELINE_DIRECTORY);

	for (const checkpoint of result.captures) {
		await updateBaseline(
			baselinePath(baselineDirectory, result.scenario, checkpoint.checkpoint),
			checkpoint.capture.snapshot,
		);
	}

	return result;
}
