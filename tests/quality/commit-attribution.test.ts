import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	attributionViolations,
	gitPrettyFormat,
	identityAttributesCursor,
	parseInspectedCommits,
	stripCoAuthorTrailers,
} from "../../tools/git/attribution.ts";

describe("commit attribution policy", () => {
	const humanName = "Iury Souza";
	const humanEmail = "iurysza@gmail.com";
	const cursorName = "Cursor Agent";
	const cursorEmail = "cursoragent@cursor.com";
	const root = join(import.meta.dir, "../..");

	test("treats Cursor Agent identities as Cursor attribution", () => {
		expect(identityAttributesCursor(cursorName, cursorEmail)).toBe(true);
		expect(identityAttributesCursor("cursor", "dev@example.com")).toBe(true);
		expect(identityAttributesCursor("Dev", "bot@cursor.com")).toBe(true);
		expect(identityAttributesCursor(humanName, humanEmail)).toBe(false);
	});

	test("strips Co-authored-by trailers and keeps the rest of the message", () => {
		const cleaned = stripCoAuthorTrailers(
			"Keep inspect actions on-screen.\n\nPin the inspect pane footer.\n\nCo-authored-by: iury souza <iurysza@users.noreply.github.com>\nCo-authored-by: Cursor <cursoragent@cursor.com>\n",
		);

		expect(cleaned).toBe("Keep inspect actions on-screen.\n\nPin the inspect pane footer.\n");
		expect(cleaned.toLowerCase().includes("co-authored-by")).toBe(false);
	});

	test("keeps Made-with trailers that are not authorship", () => {
		const cleaned = stripCoAuthorTrailers("Fix the parser.\n\nMade-with: Cursor\n");

		expect(cleaned).toBe("Fix the parser.\n\nMade-with: Cursor\n");
	});

	test("flags Cursor author, Cursor committer, and remaining co-author trailers", () => {
		expect(
			attributionViolations(
				cursorName,
				cursorEmail,
				cursorName,
				cursorEmail,
				"Fix layout.\n\nCo-authored-by: iury souza <iurysza@users.noreply.github.com>\n",
			),
		).toEqual(["cursor-author", "cursor-committer", "co-authored-by-trailer"]);
		expect(
			attributionViolations(
				humanName,
				humanEmail,
				humanName,
				humanEmail,
				"Fix layout.\n\nMade-with: Cursor\n",
			),
		).toEqual([]);
	});

	test("parses git pretty records for branch commit inspection", () => {
		const raw = [
			`abc${"\u001f"}${cursorName}${"\u001f"}${cursorEmail}${"\u001f"}${cursorName}${"\u001f"}${cursorEmail}${"\u001f"}Fix TUI.\n\nCo-authored-by: iury souza <iurysza@users.noreply.github.com>\n${"\u001e"}`,
			`def${"\u001f"}${humanName}${"\u001f"}${humanEmail}${"\u001f"}${humanName}${"\u001f"}${humanEmail}${"\u001f"}Keep attribution human.\n${"\u001e"}`,
		].join("");

		const commits = parseInspectedCommits(raw);
		const first = commits[0];
		const second = commits[1];

		expect(commits).toHaveLength(2);
		expect(first?.hash).toBe("abc");
		expect(second?.hash).toBe("def");

		if (first === undefined || second === undefined) {
			throw new Error("expected two parsed commits");
		}

		expect(
			attributionViolations(
				first.author.name,
				first.author.email,
				first.committer.name,
				first.committer.email,
				first.message,
			),
		).toEqual(["cursor-author", "cursor-committer", "co-authored-by-trailer"]);
		expect(
			attributionViolations(
				second.author.name,
				second.author.email,
				second.committer.name,
				second.committer.email,
				second.message,
			),
		).toEqual([]);
	});

	test("commit-msg hook strips co-author trailers for a human identity", async () => {
		const dir = await mkdtemp(join(tmpdir(), "logview-commit-msg-"));
		const messagePath = join(dir, "COMMIT_EDITMSG");

		await writeFile(
			messagePath,
			"Fix the parser.\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n",
		);

		const proc = Bun.spawnSync(["bun", "tools/git/commit-msg.ts", messagePath], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: humanName,
				GIT_AUTHOR_EMAIL: humanEmail,
				GIT_COMMITTER_NAME: humanName,
				GIT_COMMITTER_EMAIL: humanEmail,
			},
		});

		expect(proc.exitCode).toBe(0);
		expect(await readFile(messagePath, "utf8")).toBe("Fix the parser.\n");
	});

	test("commit-msg hook rejects Cursor as author", async () => {
		const dir = await mkdtemp(join(tmpdir(), "logview-commit-msg-"));
		const messagePath = join(dir, "COMMIT_EDITMSG");

		await writeFile(messagePath, "Fix the parser.\n");

		const proc = Bun.spawnSync(["bun", "tools/git/commit-msg.ts", messagePath], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: cursorName,
				GIT_AUTHOR_EMAIL: cursorEmail,
				GIT_COMMITTER_NAME: humanName,
				GIT_COMMITTER_EMAIL: humanEmail,
			},
		});

		expect(proc.exitCode).toBe(1);
		expect(proc.stderr.toString().includes("author or committer")).toBe(true);
	});

	test("commits since main do not attribute Cursor as author, committer, or co-author", () => {
		const base = resolveMainRef(root);

		const proc = Bun.spawnSync(
			["git", "log", `${base}..HEAD`, `--format=${gitPrettyFormat()}`],
			{
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		expect(proc.exitCode).toBe(0);

		const commits = parseInspectedCommits(proc.stdout.toString());

		for (const commit of commits) {
			expect(
				attributionViolations(
					commit.author.name,
					commit.author.email,
					commit.committer.name,
					commit.committer.email,
					commit.message,
				),
			).toEqual([]);
		}
	});
});

function resolveMainRef(root: string): string {
	const origin = Bun.spawnSync(["git", "rev-parse", "--verify", "origin/main"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});

	if (origin.exitCode === 0) return "origin/main";

	const local = Bun.spawnSync(["git", "rev-parse", "--verify", "main"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});

	if (local.exitCode === 0) return "main";

	throw new Error("no main ref available for commit attribution check");
}
