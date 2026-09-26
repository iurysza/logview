import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Schema } from "effect";
import { main } from "../src/main.ts";
import { adbStubPath } from "../../../tests/support/adb-stubs/paths.ts";
import { startFakeJev } from "../../../tests/support/fake-jev.ts";
import { FILTER_CONTRACT_CASES, FILTER_CONTRACT_FIXTURE, INVALID_FILTER_QUERIES } from "../../../tests/contract/filter-cases.ts";

const fixture = join(import.meta.dir, "../../..", FILTER_CONTRACT_FIXTURE);

type Run = Readonly<{ code: number; out: readonly string[]; err: readonly string[] }>;

async function query(...args: string[]): Promise<Run> {
	const out: string[] = [];
	const err: string[] = [];

	const code = await main(["bun", "logview", "query", ...args], {
		stdout: (line) => { out.push(line); },
		stderr: (line) => { err.push(line); },
	});

	return { code, out, err };
}

const Output = Schema.parseJson(Schema.Struct({
	v: Schema.Number,
	type: Schema.String,
	id: Schema.optional(Schema.Number),
	query: Schema.optional(Schema.String),
	stop: Schema.optional(Schema.String),
	emitted: Schema.optional(Schema.Number),
	timeout_ms: Schema.optional(Schema.Number),
	filter: Schema.optional(Schema.Struct({ minLevel: Schema.NullOr(Schema.String), tag: Schema.NullOr(Schema.String) })),
}));

function records(run: Run): readonly Schema.Schema.Type<typeof Output>[] {
	return run.out.map((line) => Schema.decodeUnknownSync(Output)(line));
}

describe("agent query CLI", () => {
	for (const contract of FILTER_CONTRACT_CASES) {
		test(`filter contract ${JSON.stringify(contract.query)}`, async () => {
			const result = await query(fixture, contract.query);
			const lines = records(result);

			expect(result.code).toBe(0);
			expect(lines.filter((line) => line.type === "event").map((line) => line.id)).toEqual([...contract.expectedIds]);
			expect(lines.at(-1)?.query).toBe(contract.canonical);
			expect(lines.at(-1)?.type).toBe("summary");
		});
	}

	for (const invalid of INVALID_FILTER_QUERIES) {
		test(`invalid query ${JSON.stringify(invalid.query)}`, async () => {
			const result = await query(fixture, invalid.query);

			expect(result.code).toBe(2);
			expect(result.out).toEqual([]);
			expect(JSON.parse(result.err[0]!).field).toBe(invalid.field);
			expect(result.err).toHaveLength(1);
		});
	}

	test("limit bounds output and stops at the second match", async () => {
		const result = await query(fixture, "level:W", "--limit", "2");
		const lines = records(result);

		expect(lines.map((line) => line.id).filter(Boolean)).toEqual([6, 8]);
		expect(lines.at(-1)).toMatchObject({ stop: "limit", emitted: 2 });
	});

	test("check validates without opening a source", async () => {
		const result = await query("--check", "level:w tag:Database");

		expect(result.code).toBe(0);
		expect(records(result)[0]).toMatchObject({ v: 1, type: "check", query: "level:W tag:Database", filter: { minLevel: "W", tag: "Database" } });
	});

	test("text streams raw lines and sends summary to stderr", async () => {
		const result = await query(fixture, "level:W tag:Database", "--format", "text");

		expect(result.code).toBe(0);
		expect(result.out).toHaveLength(3);
		expect(result.out[0]).toContain("W Database:");
		expect(result.out[1]).toContain("Store.lock");
		expect(JSON.parse(result.err[0]!)).toMatchObject({ type: "summary", emitted: 1 });
	});

	test("replay rejects relative since and accepts an absolute bound", async () => {
		const invalid = await query(fixture, "", "--since", "30s");

		expect(invalid.code).toBe(2);
		expect(JSON.parse(invalid.err[0]!)).toMatchObject({ type: "error", field: "--since" });
		const result = await query(fixture, "level:W", "--since", "1760000100.003");

		expect(records(result).filter((line) => line.type === "event").map((line) => line.id)).toEqual([8, 9, 11]);
	});

	test("live source uses fake adb and reports timeout bound", async () => {
		const result = await query("--live", "level:W", "--adb", adbStubPath("one-device"), "--serial", "emulator-5554", "--timeout", "3s");
		const lines = records(result);

		expect(result.code).toBe(0);
		expect(lines.filter((line) => line.type === "event").map((line) => line.id)).toEqual([6, 8, 9, 11]);
		expect(lines.at(-1)).toMatchObject({ stop: "eof", timeout_ms: 3000 });
	});

	test("following live source ends at timeout", async () => {
		const result = await query("--live", "--adb", adbStubPath("follow"), "--timeout", "700ms", "--since", "30s");

		expect(result.code).toBe(0);
		expect(records(result).at(-1)).toMatchObject({ stop: "timeout", timeout_ms: 700, emitted: 0 });
	});

	test("live source failure emits one JSON error on stderr", async () => {
		const result = await query("--live", "--adb", adbStubPath("no-device"), "--timeout", "3s");

		expect(result.code).toBe(1);
		expect(records(result).at(-1)?.type).toBe("summary");
		expect(result.err).toHaveLength(1);
		expect(JSON.parse(result.err[0]!)).toMatchObject({ type: "error", kind: "source-failure", field: "source" });
	});
});

describe("agent query CLI with Jev", () => {
	const JevEvent = Schema.parseJson(Schema.Struct({
		type: Schema.String,
		id: Schema.optional(Schema.Number),
		score: Schema.optional(Schema.NullOr(Schema.Number)),
		verdict: Schema.optional(Schema.String),
		query: Schema.optional(Schema.String),
		jev: Schema.optional(Schema.Struct({ relevant: Schema.Number, belowThreshold: Schema.Number, unscored: Schema.Number })),
	}));

	async function withJev<T>(mode: "score" | "auth-error", action: () => Promise<T>): Promise<T> {
		const fake = startFakeJev(mode);
		const saved = { key: process.env.TYPESAFE_API_KEY, url: process.env.TYPESAFE_BASE_URL };

		process.env.TYPESAFE_API_KEY = fake.env.TYPESAFE_API_KEY;
		process.env.TYPESAFE_BASE_URL = fake.url;

		try {
			return await action();
		} finally {
			if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY;
			else process.env.TYPESAFE_API_KEY = saved.key;

			if (saved.url === undefined) delete process.env.TYPESAFE_BASE_URL;
			else process.env.TYPESAFE_BASE_URL = saved.url;
			await fake.stop();
		}
	}

	test("~ asks Jev and emits only relevant events with score and verdict", async () => {
		const run = await withJev("score", () => query(fixture, "~database locks"));
		const lines = run.out.map((line) => Schema.decodeUnknownSync(JevEvent)(line));
		const events = lines.filter((line) => line.type === "event");

		expect(run.code).toBe(0);
		expect(events.map((line) => line.id)).toEqual([4, 5, 6, 7]);
		expect(events.every((line) => line.verdict === "relevant" && (line.score ?? 0) >= 0.5)).toBe(true);
		expect(lines.at(-1)?.query).toBe("~database locks");
		expect(lines.at(-1)?.jev).toEqual({ relevant: 4, belowThreshold: 11, unscored: 0 });
	});

	test("--semantic is the same as the ~ prefix and keeps local keys", async () => {
		const run = await withJev("score", () => query(fixture, "level:W database locks", "--semantic"));
		const lines = run.out.map((line) => Schema.decodeUnknownSync(JevEvent)(line));

		expect(run.code).toBe(0);
		expect(lines.filter((line) => line.type === "event").map((line) => line.id)).toEqual([6]);
		expect(lines.at(-1)?.query).toBe("level:W ~database locks");
	});

	test("--check reports the search mode without calling Jev", async () => {
		const run = await query("--check", "level:e ~why did it crash");

		expect(run.code).toBe(0);
		expect(run.out[0]).toContain('"searchMode":"jev"');
	});

	test("a missing TYPESAFE_API_KEY is an argument error", async () => {
		const saved = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;

		try {
			const run = await query(fixture, "~database locks");

			expect(run.code).toBe(2);
			expect(run.err[0]).toContain('"kind":"missing-api-key"');
		} finally {
			if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
		}
	});

	test("a rejected key is a Jev failure", async () => {
		const run = await withJev("auth-error", () => query(fixture, "~database locks"));

		expect(run.code).toBe(1);
		expect(run.err.at(-1)).toContain('"kind":"jev-failure"');
	});

	test("Jev queries do not run live", async () => {
		const run = await query("--live", "~database locks");

		expect(run.code).toBe(2);
	});
});
