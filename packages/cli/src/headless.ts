import type { HeadlessOutput, Session } from "@logview/engine";

export async function runHeadless(
	session: Session,
	write: (line: string) => void = (line) => {
		process.stdout.write(`${line}\n`);
	},
): Promise<number> {
	const started = session.start();

	if (!started.ok) {
		write(
			JSON.stringify({
				version: 1,
				kind: "summary",
				terminal: { kind: "failed", error: { kind: "io", message: started.error.kind } },
				snapshot: session.snapshot(),
			} satisfies HeadlessOutput),
		);
		await session.stop();

		return 1;
	}

	const terminal = await session.sourceDone;

	const output: HeadlessOutput = {
		version: 1,
		kind: "summary",
		terminal,
		snapshot: session.snapshot(),
	};

	write(JSON.stringify(output));
	await session.stop();

	if (terminal.kind === "failed") return 1;

	return 0;
}
