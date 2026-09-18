import {
	attributionViolations,
	stripCoAuthorTrailers,
} from "./attribution.ts";

async function main(): Promise<void> {
	const messagePath = process.argv[2];

	if (messagePath === undefined || messagePath.length === 0) {
		process.stderr.write("commit-msg: missing commit message path\n");
		process.exit(2);
	}

	const original = await Bun.file(messagePath).text();
	const message = stripCoAuthorTrailers(original);
	const authorName = process.env.GIT_AUTHOR_NAME ?? "";
	const authorEmail = process.env.GIT_AUTHOR_EMAIL ?? "";
	const committerName = process.env.GIT_COMMITTER_NAME ?? "";
	const committerEmail = process.env.GIT_COMMITTER_EMAIL ?? "";

	const violations = attributionViolations(
		authorName,
		authorEmail,
		committerName,
		committerEmail,
		message,
	);

	if (violations.length > 0) {
		process.stderr.write(
			"Commit blocked: do not name Cursor as author or committer, and do not include Co-authored-by trailers.\n",
		);
		process.exit(1);
	}

	await Bun.write(messagePath, message);
}

await main();
