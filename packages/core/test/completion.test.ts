import { describe, expect, test } from "bun:test";
import { acceptCompletion, completeQuery, EMPTY_CANDIDATES, type QueryCandidates } from "@logview/core";

const seen: QueryCandidates = {
	tags: ["Database", "logview-demo", "ActivityManager", "My Tag"],
	pids: [4321, 1234, 1],
	packages: ["com.example.logview.demo"],
};

function ghost(draft: string, cursor = [...draft].length, candidates = seen): string | null {
	return completeQuery(draft, cursor, candidates)?.ghost ?? null;
}

describe("query completion", () => {
	test("a bare prefix completes to a key", () => {
		expect(ghost("le")).toBe("vel:");
		expect(ghost("p")).toBe("id:");
		expect(ghost("lock")).toBeNull();
	});

	test("level: offers levels in severity order", () => {
		expect(ghost("level:")).toBe("V");
		expect(ghost("level:w")).toBeNull();
		expect(completeQuery("level:", 6, seen)?.alternatives).toEqual(["D", "I", "W", "E", "F"]);
	});

	test("tag:, pid: and pkg: offer seen values, most frequent first", () => {
		expect(ghost("tag:")).toBe("Database");
		expect(ghost("tag:log")).toBe("view-demo");
		expect(ghost("tag:act")).toBe("ivityManager");
		expect(ghost("pid:12")).toBe("34");
		expect(ghost("pkg:com")).toBe(".example.logview.demo");
		expect(ghost("tag:", 4, EMPTY_CANDIDATES)).toBeNull();
	});

	test("values that need quotes are not offered", () => {
		expect(ghost("tag:M")).toBeNull();
		expect(ghost('tag:"M')).toBeNull();
	});

	test("completion works on the word before the cursor only", () => {
		expect(ghost("level:W ta")).toBe("g:");
		expect(ghost("tag:Data lock", 8)).toBe("base");
		expect(completeQuery("tag:Data", 5, seen)).toBeNull();
		expect(ghost("~ta")).toBeNull();
	});

	test("accepting a case-folded match replaces the typed word", () => {
		const completion = completeQuery("level:W tag:data x", 16, seen);

		expect(completion).not.toBeNull();

		if (completion === null) return;

		expect(acceptCompletion("level:W tag:data x", 16, completion)).toEqual({ draft: "level:W tag:Database x", cursor: 20 });
	});
});
