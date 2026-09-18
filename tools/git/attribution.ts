export type GitPerson = Readonly<{
	name: string;
	email: string;
}>;

export type InspectedCommit = Readonly<{
	hash: string;
	author: GitPerson;
	committer: GitPerson;
	message: string;
}>;

export type AttributionViolation =
	| "cursor-author"
	| "cursor-committer"
	| "co-authored-by-trailer";

const UNIT = "\u001f";

const RECORD = "\u001e";

const CO_AUTHOR_TRAILER = /^\s*co-authored-by\s*:/i;

export function identityAttributesCursor(name: string, email: string): boolean {
	const normalizedName = name.trim().toLowerCase();
	const normalizedEmail = email.trim().toLowerCase();

	return (
		normalizedName.includes("cursor") ||
		normalizedEmail.includes("cursoragent") ||
		normalizedEmail.endsWith("@cursor.com") ||
		normalizedEmail.endsWith("@cursor.sh")
	);
}

export function isCoAuthorTrailer(line: string): boolean {
	return CO_AUTHOR_TRAILER.test(line);
}

export function stripCoAuthorTrailers(message: string): string {
	const kept: string[] = [];

	for (const line of splitCommitLines(message)) {
		if (isCoAuthorTrailer(line)) continue;
		kept.push(line);
	}

	return normalizeCommitMessage(kept);
}

export function attributionViolations(
	authorName: string,
	authorEmail: string,
	committerName: string,
	committerEmail: string,
	message: string,
): readonly AttributionViolation[] {
	const violations: AttributionViolation[] = [];

	if (identityAttributesCursor(authorName, authorEmail)) {
		violations.push("cursor-author");
	}

	if (identityAttributesCursor(committerName, committerEmail)) {
		violations.push("cursor-committer");
	}

	if (messageHasCoAuthorTrailer(message)) {
		violations.push("co-authored-by-trailer");
	}

	return violations;
}

export function parseInspectedCommits(raw: string): readonly InspectedCommit[] {
	const commits: InspectedCommit[] = [];

	for (const record of raw.split(RECORD)) {
		const parsed = parseInspectedCommit(record.trim());

		if (parsed === null) continue;
		commits.push(parsed);
	}

	return commits;
}

export function gitPrettyFormat(): string {
	return `%H${UNIT}%an${UNIT}%ae${UNIT}%cn${UNIT}%ce${UNIT}%B${RECORD}`;
}

function messageHasCoAuthorTrailer(message: string): boolean {
	for (const line of splitCommitLines(message)) {
		if (isCoAuthorTrailer(line)) return true;
	}

	return false;
}

function parseInspectedCommit(record: string): InspectedCommit | null {
	if (record.length === 0) return null;

	const parts = record.split(UNIT);

	if (parts.length < 6) return null;

	const hash = parts[0];
	const authorName = parts[1];
	const authorEmail = parts[2];
	const committerName = parts[3];
	const committerEmail = parts[4];
	const message = parts.slice(5).join(UNIT);

	if (
		hash === undefined ||
		authorName === undefined ||
		authorEmail === undefined ||
		committerName === undefined ||
		committerEmail === undefined ||
		message === undefined
	) {
		return null;
	}

	return {
		hash,
		author: { name: authorName, email: authorEmail },
		committer: { name: committerName, email: committerEmail },
		message,
	};
}

function splitCommitLines(message: string): string[] {
	const lines = message.split("\n");
	const out: string[] = [];

	for (const line of lines) {
		out.push(line.endsWith("\r") ? line.slice(0, -1) : line);
	}

	return out;
}

function normalizeCommitMessage(lines: readonly string[]): string {
	const trimmed = [...lines];

	while (trimmed.length > 0) {
		const last = trimmed[trimmed.length - 1];

		if (last === undefined || last.trim() !== "") break;
		trimmed.pop();
	}

	if (trimmed.length === 0) return "\n";

	return `${trimmed.join("\n")}\n`;
}
