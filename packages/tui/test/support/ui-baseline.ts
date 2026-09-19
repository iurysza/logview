import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	diffSnapshots,
	formatSnapshotDiff,
	parseStyledSnapshot,
	serializeSnapshot,
	textFromSnapshot,
	type SnapshotDiff,
	type StyledSnapshot,
} from "./styled-snapshot.ts";

export type BaselineComparison =
	| Readonly<{ kind: "match"; baselinePath: string }>
	| Readonly<{ kind: "missing"; baselinePath: string; message: string }>
	| Readonly<{ kind: "invalid"; baselinePath: string; message: string }>
	| Readonly<{ kind: "mismatch"; baselinePath: string; diff: SnapshotDiff; message: string }>;

export function baselinePath(root: string, scenario: string, checkpoint: string): string {
	return join(root, scenario, `${checkpoint}.snapshot.json`);
}

export async function compareBaseline(path: string, actual: StyledSnapshot): Promise<BaselineComparison> {
	let baselineText: string;

	try {
		baselineText = await readFile(path, "utf8");
	} catch (cause) {
		if (isMissingFile(cause)) {
			return {
				kind: "missing",
				baselinePath: path,
				message: `missing baseline ${path}; review the generated evidence, then run ui:update --scenario NAME`,
			};
		}

		throw new Error(`failed to read baseline ${path}: ${errorMessage(cause)}`);
	}

	let expected: StyledSnapshot;

	try {
		expected = parseStyledSnapshot(baselineText);
	} catch (cause) {
		return {
			kind: "invalid",
			baselinePath: path,
			message: `invalid baseline ${path}: ${errorMessage(cause)}`,
		};
	}

	const diff = diffSnapshots(expected, actual);

	if (diff.equal) return { kind: "match", baselinePath: path };

	return {
		kind: "mismatch",
		baselinePath: path,
		diff,
		message: `baseline ${path} differs:\n${formatSnapshotDiff(diff)}`,
	};
}

export async function updateBaseline(path: string, snapshot: StyledSnapshot): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, serializeSnapshot(snapshot), "utf8");
}

export async function writeFailureEvidence(options: {
	directory: string;
	comparison: Exclude<BaselineComparison, { kind: "match" }>;
	actual: StyledSnapshot;
}): Promise<void> {
	const { actual, comparison, directory } = options;
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "actual.snapshot.json"), serializeSnapshot(actual), "utf8");
	await writeFile(join(directory, "actual.txt"), textFromSnapshot(actual), "utf8");

	if (comparison.kind === "mismatch") {
		const expected = await readFile(comparison.baselinePath, "utf8");
		const expectedSnapshot = parseStyledSnapshot(expected);
		await writeFile(join(directory, "expected.snapshot.json"), serializeSnapshot(expectedSnapshot), "utf8");
		await writeFile(join(directory, "expected.txt"), textFromSnapshot(expectedSnapshot), "utf8");
		await writeFile(join(directory, "cells.diff.txt"), `${formatSnapshotDiff(comparison.diff)}\n`, "utf8");

		return;
	}

	await writeFile(join(directory, "baseline-error.txt"), `${comparison.message}\n`, "utf8");
}

function isMissingFile(cause: unknown): boolean {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : "unknown error";
}
