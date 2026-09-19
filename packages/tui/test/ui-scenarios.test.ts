import { test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { UI_SCENARIO_NAMES, type UiScenarioName } from "./support/ui-scenarios.ts";
import { removeCaptureDirectory } from "./support/ui-capture.ts";
import { UI_BASELINE_DIRECTORY, verifyUiScenario } from "./support/ui-workflow.ts";

const repoRoot = join(import.meta.dir, "../../..");

function committedScenarios(): readonly UiScenarioName[] {
	const root = join(repoRoot, UI_BASELINE_DIRECTORY);

	return UI_SCENARIO_NAMES.filter((name) => {
		try {
			return statSync(join(root, name)).isDirectory();
		} catch {
			return false;
		}
	});
}

const scenarios = committedScenarios();

if (scenarios.length === 0) {
	throw new Error(
		`no reviewed UI baselines under ${UI_BASELINE_DIRECTORY}; run bun run ui:update --scenario NAME after review`,
	);
}

for (const scenario of scenarios) {
	test(`UI scenario ${scenario}`, async () => {
		const outDirectory = join(repoRoot, "generated/ui/test", `${scenario}-${process.pid}`);
		let passed = false;
		await removeCaptureDirectory(outDirectory);

		try {
			await verifyUiScenario({ cwd: repoRoot, scenario, outDirectory });
			passed = true;
		} finally {
			if (passed) await removeCaptureDirectory(outDirectory);
		}
	}, 30_000);
}
