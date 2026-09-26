import { describe, expect, test } from "bun:test";
import { EMPTY_FILTER, formatFilterQuery, formatQuery, parseFilterQuery, parseQuery, textMatchRanges, type FilterSpec } from "@logcayo/core";

function parsed(query: string): FilterSpec {
	const result = parseFilterQuery(query);

	if (!result.ok) throw new Error(`${query}: ${result.error.message}`);

	return result.value;
}

function failure(query: string) {
	const result = parseFilterQuery(query);

	if (result.ok) throw new Error(`${query}: expected an error`);

	return result.error;
}

describe("filter query language", () => {
	test("empty query is the empty filter", () => {
		expect(parsed("")).toEqual(EMPTY_FILTER);
		expect(parsed("   ")).toEqual(EMPTY_FILTER);
		expect(formatFilterQuery(EMPTY_FILTER)).toBe("");
	});

	test("parses every key and joins text terms with one space", () => {
		expect(parsed("level:w tag:Database pid:4321 pkg:com.example.app lock   timeout")).toEqual({
			minLevel: "W",
			tag: "Database",
			pid: 4321,
			packageName: "com.example.app",
			text: "lock timeout",
		});
	});

	test("plain words stay text search so the old / habit keeps working", () => {
		expect(parsed("Database")).toEqual({ ...EMPTY_FILTER, text: "Database" });
	});

	test("level:ALL clears the level", () => {
		expect(parsed("level:ALL").minLevel).toBeNull();
	});

	test("unknown keys and URLs are text, so typos stay visible", () => {
		expect(parsed("lvl:W").text).toBe("lvl:W");
		expect(parsed("http://host:80/x").text).toBe("http://host:80/x");
		expect(parsed("Level:W").text).toBe("Level:W");
	});

	test("quotes keep exact spacing and escape key-like text", () => {
		expect(parsed('"a  b"').text).toBe("a  b");
		expect(parsed('"tag:x"')).toEqual({ ...EMPTY_FILTER, text: "tag:x" });
		expect(parsed('tag:"My Tag"').tag).toBe("My Tag");
		expect(parsed('"say \\"hi\\" \\\\"').text).toBe('say "hi" \\');
	});

	test("reports errors with field and offset", () => {
		expect(failure("tag:x pid:0")).toMatchObject({ field: "pid", offset: 6 });
		expect(failure("level:Q")).toMatchObject({ field: "minLevel", offset: 0 });
		expect(failure("tag:a tag:b")).toMatchObject({ field: "tag", offset: 6 });
		expect(failure("tag:")).toMatchObject({ field: "tag" });
		expect(failure('x "open')).toMatchObject({ field: "query", offset: 2 });
		expect(failure('"a"b')).toMatchObject({ field: "query", offset: 3 });
		expect(failure(`tag:${"x".repeat(300)}`)).toMatchObject({ field: "tag" });
	});

	test("canonical form orders keys and round-trips", () => {
		expect(formatFilterQuery(parsed("lock pid:7 level:e"))).toBe("level:E pid:7 lock");
	});

	test("parse(format(spec)) === spec for generated specs", () => {
		const levels = [null, "V", "D", "I", "W", "E", "F"] as const;
		const tags = [null, "Database", "My Tag", 'q"uote', "back\\slash", "tag:x"];
		const pids = [null, 1, 4321];
		const packages = [null, "com.example.app", "odd pkg"];
		const texts = ["", "lock", "lock timeout", "a  b", " lead", "trail ", "pid:3", '"quoted"', "http://h:1", "日本語"];
		let checked = 0;

		for (const minLevel of levels) {
			for (const tag of tags) {
				for (const pid of pids) {
					for (const packageName of packages) {
						for (const text of texts) {
							const spec: FilterSpec = { minLevel, tag, pid, packageName, text };
							expect(parsed(formatFilterQuery(spec))).toEqual(spec);
							checked += 1;
						}
					}
				}
			}
		}

		expect(checked).toBe(7 * 6 * 3 * 3 * 10);
	});
});

describe("textMatchRanges", () => {
	test("finds case-insensitive, non-overlapping ranges", () => {
		expect(textMatchRanges("Lock lock LOCK", { ...EMPTY_FILTER, text: "lock" })).toEqual([
			{ start: 0, end: 4 },
			{ start: 5, end: 9 },
			{ start: 10, end: 14 },
		]);
	});

	test("no text filter means no ranges", () => {
		expect(textMatchRanges("anything", EMPTY_FILTER)).toEqual([]);
	});

	test("falls back to no ranges when folding changes length", () => {
		expect(textMatchRanges("İstanbul", { ...EMPTY_FILTER, text: "stan" })).toEqual([]);
	});
});

describe("Jev prefix", () => {
	function jev(query: string) {
		const result = parseQuery(query);

		if (!result.ok) throw new Error(`${query}: ${result.error.message}`);

		return result.value;
	}

	test("~ before the text asks Jev and keeps the other keys local", () => {
		expect(jev("level:W ~database locks")).toEqual({
			filter: { ...EMPTY_FILTER, minLevel: "W", text: "database locks" },
			searchMode: "jev",
		});
		expect(jev("~ why did it crash").filter.text).toBe("why did it crash");
		expect(jev('~"tag:x means"').filter.text).toBe("tag:x means");
	});

	test("~ later in the text, or quoted, is literal", () => {
		expect(jev("a ~b")).toEqual({ filter: { ...EMPTY_FILTER, text: "a ~b" }, searchMode: "text" });
		expect(jev('"~home"')).toEqual({ filter: { ...EMPTY_FILTER, text: "~home" }, searchMode: "text" });
		expect(formatFilterQuery({ ...EMPTY_FILTER, text: "~home" })).toBe('"~home"');
	});

	test("an empty ~ is an error at the tilde", () => {
		const result = parseQuery("level:E ~");

		expect(result.ok ? null : result.error).toMatchObject({ field: "text", offset: 8 });
	});

	test("parseFilterQuery rejects a Jev query instead of searching for it literally", () => {
		const result = parseFilterQuery("~locks");

		expect(result.ok).toBe(false);
	});

	test("formatQuery round-trips both modes", () => {
		const texts = ["lock", "database locks", "a  b", "tag:x", "~home", '"q"'];

		for (const text of texts) {
			for (const searchMode of ["text", "jev"] as const) {
				const spec = { ...EMPTY_FILTER, minLevel: "E" as const, text };
				expect(jev(formatQuery(spec, searchMode))).toEqual({ filter: spec, searchMode });
			}
		}

		expect(formatQuery(EMPTY_FILTER, "jev")).toBe("");
	});
});
