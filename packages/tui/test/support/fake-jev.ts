import { Either, Schema } from "effect";

/**
 * Local stand-in for the TypeSafe `/v1/systemone` endpoint. UI scenarios point
 * the real CLI at it through `TYPESAFE_BASE_URL`, so no scenario reaches the
 * network. Scores are a pure function of the log line, so captures are stable.
 */

type LogEntry = Readonly<{ id: string; tag: string | null; message: string }>;

type FakeJevMode = "score" | "auth-error";

export type FakeJev = Readonly<{
	url: string;
	env: Readonly<Record<string, string>>;
	/** Holds responses until `release()`, so a scenario can capture pending rows. */
	hold(): void;
	release(): void;
	requests(): number;
	stop(): Promise<void>;
}>;

const RELEVANT = /database|lock|transaction|sqlite|store/i;

const RELATED = /select|write|commit|connection/i;

export function fakeScore(entry: LogEntry): number {
	const text = `${entry.tag ?? ""} ${entry.message}`;

	if (RELEVANT.test(entry.message)) return 0.93;

	if (RELEVANT.test(text) || RELATED.test(text)) return 0.71;

	return 0.08;
}

const SystemOneRequest = Schema.Struct({
	state: Schema.Struct({
		logs: Schema.Array(Schema.Struct({ id: Schema.String, tag: Schema.optional(Schema.NullOr(Schema.String)), message: Schema.String })),
	}),
});

function logsOf(text: string): readonly LogEntry[] {
	return Either.match(Schema.decodeUnknownEither(Schema.parseJson(SystemOneRequest))(text), {
		onLeft: () => [],
		onRight: (request) => request.state.logs.map((log) => ({ id: log.id, tag: log.tag ?? null, message: log.message })),
	});
}

export function startFakeJev(mode: FakeJevMode = "score"): FakeJev {
	let held = false;
	let count = 0;
	const waiting: Array<() => void> = [];

	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			count += 1;

			if (mode === "auth-error") {
				return Response.json({ error: { message: "invalid api key" } }, { status: 401 });
			}

			const logs = logsOf(await request.text());

			if (held) await new Promise<void>((resolve) => waiting.push(resolve));

			const answers: Record<string, { type: "noul"; noul: number }> = {};

			for (const entry of logs) answers[entry.id] = { type: "noul", noul: fakeScore(entry) };

			return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } });
		},
	});

	const url = `http://127.0.0.1:${server.port}`;

	return {
		url,
		env: { TYPESAFE_API_KEY: "fake-key-for-ui-tests", TYPESAFE_BASE_URL: url },
		hold: () => {
			held = true;
		},
		release: () => {
			held = false;

			for (const resolve of waiting.splice(0)) resolve();
		},
		requests: () => count,
		stop: async () => {
			held = false;

			for (const resolve of waiting.splice(0)) resolve();
			await server.stop(true);
		},
	};
}
