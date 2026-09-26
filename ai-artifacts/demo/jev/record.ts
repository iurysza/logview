// Records the Jev demo with a local fake Jev: no API key, no network.
// Run from the repository root: bun ai-artifacts/demo/jev/record.ts
import { startFakeJev } from "../../../tests/support/fake-jev.ts";

const NAME = "jev-demo";
const OUT = "generated/demo/jev.termctrl";
const fake = startFakeJev("score");

async function tc(...args: string[]): Promise<void> {
	const proc = Bun.spawn(["termctrl", ...args], { stdout: "inherit", stderr: "inherit" });

	if ((await proc.exited) !== 0) throw new Error(`termctrl ${args.join(" ")} failed`);
}

async function step(marker: string, keys: readonly string[], waitFor: string, pauseMs = 700): Promise<void> {
	for (const key of keys) {
		await tc("send", NAME, key);
		await Bun.sleep(key.startsWith("text:") ? 60 : 180);
	}

	await tc("wait", NAME, waitFor);
	await Bun.sleep(pauseMs);
	await tc("mark", NAME, marker);
}

function typed(text: string): string[] {
	return [...text].map((char) => `text:${char}`);
}

await Bun.$`mkdir -p generated/demo && rm -f ${OUT}`;
await Bun.$`termctrl stop ${NAME}`.nothrow().quiet();

const env = Object.entries(fake.env).map(([key, value]) => `${key}=${value}`);

function erase(count: number): string[] {
	return Array.from({ length: count }, () => "backspace");
}

try {
	await tc(
		"start", NAME, "--record", OUT, "--cols", "120", "--rows", "24", "--color", "always", "--",
		"env", ...env, process.execPath, "packages/cli/src/main.ts", "replay",
		"tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl", "--speed", "instant", "--semantic",
	);
	await tc("wait", NAME, "REPLAY • END");
	await Bun.sleep(900);
	await tc("mark", NAME, "list");

	await step("open", ["text:/"], "~question asks Jev");
	await step("literal", typed("lock"), "2 of 15", 900);
	await step("cleared", erase(4), "~question asks Jev", 300);
	fake.hold();
	await step("draft", typed("~database locks"), "Enter asks Jev", 900);
	await step("asking", ["enter"], "asking", 900);
	fake.release();
	await step("scored", [], "relevant", 1600);
	await step("hidden", ["text:v"], "hidden", 1600);
	await step("shown", ["text:v"], "Hide weak", 700);
	await step("text", ["text:m"], "Text / database locks", 1200);
	await step("tag", ["text:/", ...erase(16), ...typed("tag:"), "tab"], "tag:logview-demo", 900);
	await step("values", [...erase(16), ...typed("tag:Da")], "tag:Database", 900);
	await step("accepted", ["tab", "enter"], "4 of 15", 1200);
	await tc("send", NAME, "text:q");
	await Bun.sleep(400);
	await tc("mark", NAME, "quit");
} finally {
	await Bun.$`termctrl stop ${NAME}`.nothrow().quiet();
	await fake.stop();
}
