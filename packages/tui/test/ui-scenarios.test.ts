import { test } from "bun:test";
import { join } from "node:path";
import { UI_SCENARIO_NAMES } from "./support/ui-scenarios.ts";
import { removeCaptureDirectory } from "./support/ui-capture.ts";
import { verifyUiScenario } from "./support/ui-workflow.ts";

const repoRoot = join(import.meta.dir, "../../..");

for (const scenario of UI_SCENARIO_NAMES) {
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
