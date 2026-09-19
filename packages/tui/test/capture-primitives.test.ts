import { describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareBaseline, updateBaseline } from "./support/ui-baseline.ts";
import {
	inspectTerminalControlBinary,
	removeCaptureDirectory,
	resolveTerminalControl,
	TERMCTRL_VERSION,
	waitForText,
	withTerminalSession,
} from "./support/ui-capture.ts";
import {
	diffSnapshots,
	formatSnapshotDiff,
	snapshotFromTerminalControl,
	type StyledSnapshot,
} from "./support/styled-snapshot.ts";

const repoRoot = join(import.meta.dir, "../../..");

function sampleSnapshot(): StyledSnapshot {
	return snapshotFromTerminalControl(
		JSON.stringify({
			version: 1,
			cols: 4,
			rows: 1,
			foreground: { r: 201, g: 209, b: 217 },
			background: { r: 13, g: 17, b: 23 },
			cells: [
				cell(0, "A", { r: 205, g: 49, b: 49 }),
				cell(1, "B", { r: 205, g: 49, b: 49 }),
				cell(2, "日", { r: 201, g: 209, b: 217 }, 2),
			],
		}),
	);
}

function cell(x: number, text: string, foreground: { r: number; g: number; b: number }, width = 1) {
	return {
		x,
		y: 0,
		text,
		width,
		foreground,
		background: { r: 13, g: 17, b: 23 },
		attributes: {
			bold: false,
			italic: false,
			faint: false,
			invisible: false,
			strikethrough: false,
			overline: false,
			underline: null,
		},
	};
}

describe("styled UI baselines", () => {
	test("stores same-style cells as compact spans and reports style-only changes", () => {
		const expected = sampleSnapshot();
		expect(expected.spans).toHaveLength(2);
		expect(expected.spans[0]).toMatchObject({ text: "AB" });

		const actual: StyledSnapshot = {
			...expected,
			spans: expected.spans.map((span, index) =>
				index === 0 ? { ...span, foreground: { r: 13, g: 188, b: 121 } } : span,
			),
		};

		const diff = diffSnapshots(expected, actual);
		expect(diff.equal).toBe(false);
		expect(diff.changes).toContainEqual({
			kind: "cell",
			row: 0,
			column: 0,
			property: "foreground",
			expected: "rgb(205,49,49)",
			actual: "rgb(13,188,121)",
		});
		expect(formatSnapshotDiff(diff)).toContain("row 0 col 0 foreground");
	});

	test("does not create or rewrite a baseline while comparing", async () => {
		const directory = join(repoRoot, "generated/ui/baseline-policy", String(process.pid));
		const path = join(directory, "sample.snapshot.json");
		const snapshot = sampleSnapshot();
		await removeCaptureDirectory(directory);

		try {
			const missing = await compareBaseline(path, snapshot);
			expect(missing.kind).toBe("missing");
			expect(await Bun.file(path).exists()).toBe(false);

			await updateBaseline(path, snapshot);
			const before = await readFile(path, "utf8");

			const changed: StyledSnapshot = {
				...snapshot,
				spans: snapshot.spans.map((span, index) =>
					index === 0 ? { ...span, foreground: { r: 13, g: 188, b: 121 } } : span,
				),
			};

			const mismatch = await compareBaseline(path, changed);
			expect(mismatch.kind).toBe("mismatch");
			expect(await readFile(path, "utf8")).toBe(before);
		} finally {
			await removeCaptureDirectory(directory);
		}
	});
});

describe("pinned Terminal Control", () => {
	test("uses the installed 0.4.1 binary and rejects a mismatched binary", async () => {
		const installed = await resolveTerminalControl(repoRoot);
		expect(installed.version).toBe(TERMCTRL_VERSION);

		const directory = join(repoRoot, "generated/ui/tool-check", String(process.pid));
		const fake = join(directory, "termctrl");
		await mkdir(directory, { recursive: true });

		try {
			await writeFile(fake, "#!/bin/sh\necho 'termctrl 9.9.9'\n", "utf8");
			await chmod(fake, 0o755);
			await expect(inspectTerminalControlBinary(fake, repoRoot)).rejects.toThrow(TERMCTRL_VERSION);
		} finally {
			await removeCaptureDirectory(directory);
		}
	});

	test("stops an owned child process when scenario work fails", async () => {
		const tool = await resolveTerminalControl(repoRoot);
		let childPid = 0;

		await expect(
			withTerminalSession(
				tool,
				{
					cwd: repoRoot,
					command: ["sh", "-c", "echo ready:$$; exec sleep 30"],
					viewport: { cols: 20, rows: 4 },
					color: "never",
				},
				async (session) => {
					await waitForText(session, "ready:");
					childPid = Number((await session.screen.text()).trim().slice("ready:".length));
					throw new Error("forced scenario failure");
				},
			),
		).rejects.toThrow("forced scenario failure");

		expect(childPid).toBeGreaterThan(0);
		expect(processExists(childPid)).toBe(false);
	});
});

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
}
