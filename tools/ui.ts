import {
	isUiScenarioName,
	UI_SCENARIO_NAMES,
	type UiScenarioName,
} from "../packages/tui/test/support/ui-scenarios.ts";
import { updateUiScenarioBaselines, verifyUiScenario } from "../packages/tui/test/support/ui-workflow.ts";

type Command = "verify" | "update";

type Request = Readonly<{
	command: Command;
	scenario: UiScenarioName;
	output: string | null;
}>;

function usage(): string {
	return [
		"Usage:",
		"  bun run ui:verify --scenario NAME --out PATH",
		"  bun run ui:update --scenario NAME [--out PATH]",
		`Scenarios: ${UI_SCENARIO_NAMES.join(", ")}`,
	].join("\n");
}

function parse(argv: readonly string[]): Request {
	const [command, ...rest] = argv;

	if (command !== "verify" && command !== "update") throw new Error(usage());

	let scenario: UiScenarioName | null = null;
	let output: string | null = null;

	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];

		if (argument === "--scenario" || argument === "--out") {
			const value = rest[index + 1];

			if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}\n${usage()}`);
			if (argument === "--scenario") {
				if (!isUiScenarioName(value)) {
					throw new Error(`--scenario must be one of ${UI_SCENARIO_NAMES.join(", ")}\n${usage()}`);
				}
				scenario = value;
			} else output = value;
			index += 1;
			continue;
		}

		throw new Error(`unknown argument ${argument}\n${usage()}`);
	}

	if (!scenario) {
		throw new Error(`--scenario must be one of ${UI_SCENARIO_NAMES.join(", ")}\n${usage()}`);
	}

	if (command === "verify" && !output) throw new Error(`ui:verify requires --out PATH\n${usage()}`);

	return { command, scenario, output };
}

async function main(): Promise<void> {
	const request = parse(process.argv.slice(2));
	const output = request.output ?? `generated/ui/baseline-review/${request.scenario}`;
	const options = { cwd: process.cwd(), scenario: request.scenario, outDirectory: output };
	const result =
		request.command === "verify"
			? await verifyUiScenario(options)
			: await updateUiScenarioBaselines(options);

	for (const checkpoint of result.captures) {
		process.stdout.write(`${checkpoint.checkpoint}: ${checkpoint.capture.paths.png}\n`);
	}
}

main().catch((cause) => {
	process.stderr.write(`${cause instanceof Error ? cause.message : "UI workflow failed"}\n`);
	process.exitCode = 1;
});
