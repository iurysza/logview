import { describe, expect, test } from "bun:test";
import { INSPECT_FOCUS, LIST_FOCUS, NONE_CLASSIFICATION, displayWidth, type LogEvent, type ViewRow } from "@logview/core";
import type { SessionSnapshot } from "@logview/engine";
import { EMPTY_FILTER, EMPTY_VIEW } from "@logview/core";
import {
	decodeTerminalInput,
	decodeTerminalKey,
	TerminalInputDecoder,
	formatFilter,
	formatFooter,
	formatHints,
	formatStatus,
	layoutFrame,
	layoutSession,
	renderRowText,
} from "../src/app.ts";
import { paintStyleFromEnv } from "../src/color.ts";
import { rgbSgr } from "../src/catppuccin.ts";
import { THEME } from "../src/theme.ts";
import { paintLogList, visiblePoolSize } from "../src/log-list.ts";

const snapshot: SessionSnapshot = {
	sessionId: "demo",
	sourceKind: "replay",
	label: "sanitized-aosp-pattern.lvr.jsonl",
	revision: 1,
	source: { kind: "ended", reason: "eof" },
	sourceNotices: [],
	activeFilter: EMPTY_FILTER,
	activeFilterRevision: 0,
	pendingFilter: null,
	view: EMPTY_VIEW,
	rows: [],
	selectedEvent: null,
	stats: {
		receivedBytes: 0,
		admittedEvents: 0,
		retainedEvents: 18,
		matchedEvents: 14,
		evictedEvents: 0,
		unparsedEvents: 0,
		truncatedEvents: 0,
		omittedBytes: 0,
		queuedBytes: 0,
		chargedHistoryBytes: 0,
		lagging: false,
		upstreamLoss: "unknown",
	},
	semantic: null,
	notice: null,
};

const selectedEvent: LogEvent = {
	id: 7,
	sourceOffsetMs: 0,
	rawText: "1760000000.002800  4321  4321 W Database: Retry after lock timeout",
	metadata: {
		epochMicros: 1760000000002800,
		pid: 4321,
		tid: 4321,
		level: "W",
		tag: { start: 32, end: 40 },
		message: { start: 42, end: 66 },
	},
	continuations: ["\tat com.example.logview.demo.db.Store.lock(Store.java:88)"],
	endedWithLf: true,
	omittedBytes: 0,
	invalidUtf8: false,
	chargeBytes: 120,
};

const inspectSnapshot: SessionSnapshot = {
	...snapshot,
	selectedEvent,
	stats: { ...snapshot.stats, retainedEvents: 15, matchedEvents: 15 },
};

const jevSnapshot: SessionSnapshot = {
	...snapshot,
	activeFilter: { ...EMPTY_FILTER, text: "database failures" },
	rows: [
		{
			id: 1,
			selected: false,
			level: "I",
			kind: "header",
			spans: [{ text: "low relevance", role: "message" }],
			clipped: false,
			classification: { kind: "scored", relevance: 0.1 },
		},
		{
			id: 2,
			selected: false,
			level: "I",
			kind: "header",
			spans: [{ text: "high relevance", role: "message" }],
			clipped: false,
			classification: { kind: "scored", relevance: 0.9 },
		},
		{
			id: 3,
			selected: false,
			level: "I",
			kind: "header",
			spans: [{ text: "awaiting result", role: "message" }],
			clipped: false,
			classification: { kind: "pending" },
		},
		{
			id: 4,
			selected: false,
			level: "I",
			kind: "header",
			spans: [{ text: "request failed", role: "message" }],
			clipped: false,
			classification: { kind: "unknown", reason: "failed" },
		},
		{
			id: 5,
			selected: false,
			level: "I",
			kind: "header",
			spans: [{ text: "older row", role: "message" }],
			clipped: false,
			classification: { kind: "unrequested" },
		},
		{
			id: 6,
			selected: false,
			level: "I",
			kind: "header",
			spans: [{ text: "queue full", role: "message" }],
			clipped: false,
			classification: { kind: "unknown", reason: "skipped" },
		},
	],
	semantic: {
		queryText: "database failures",
		queryRevision: 1,
		threshold: 0.5,
		classifiedEvents: 2,
		pendingEvents: 1,
		skippedEvents: 1,
		failedEvents: 1,
		inFlight: 0,
	},
};

function visibleText(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("tui chrome", () => {
	test("formats status, filters, footer, and hints without a renderer", () => {
		expect(formatStatus(snapshot)).toContain("REPLAY • END");
		expect(formatFilter(snapshot)).toContain("Tag: any");
		expect(formatFooter(snapshot)).toContain("TAIL");
		expect(formatHints()).toContain("q Quit");
		expect(layoutSession(snapshot, LIST_FOCUS).join("\n")).toContain("Quit");
	});

	test("layoutFrame paints exactly rows by columns in plain mode", () => {
		const frame = layoutFrame(snapshot, LIST_FOCUS, 72, 16, "plain");
		expect(frame).toHaveLength(16);

		for (const line of frame) {
			expect(displayWidth(line)).toBe(72);
		}
	});

	test("ansi status fits 48 columns like the plain branch", () => {
		const plain = layoutFrame(inspectSnapshot, LIST_FOCUS, 48, 12, "plain");
		const ansi = layoutFrame(inspectSnapshot, LIST_FOCUS, 48, 12, "ansi");
		const visible = visibleText(ansi[0]!);

		expect(displayWidth(plain[0]!)).toBe(48);
		expect(displayWidth(visible)).toBe(48);
		expect(visible).toBe(plain[0]!);
		expect(visible.startsWith("logview")).toBe(true);
		expect(visible).toContain("15 events");
	});

	test("Enter inspect is a full-viewport overlay on a narrow frame", () => {
		const frame = layoutFrame(inspectSnapshot, INSPECT_FOCUS, 72, 16, "plain");
		expect(frame).toHaveLength(16);
		expect(frame.join("\n")).toContain("Event");
		expect(frame.join("\n")).toContain("t filter tag");
		expect(frame.join("\n")).toContain("p filter pid");
		expect(frame.join("\n")).toContain("Esc close");
		expect(frame.join("\n")).toContain("Retry after lock timeout");
		expect(frame.join("\n")).toContain("INSPECT");

		for (const line of frame) {
			expect(displayWidth(line)).toBe(72);
		}
	});

	test("wide inspect splits the log list and the pane", () => {
		const frame = layoutFrame(inspectSnapshot, INSPECT_FOCUS, 120, 18, "plain");
		expect(frame).toHaveLength(18);
		expect(frame.join("\n")).toContain("│");
		expect(frame.join("\n")).toContain("Event");
		expect(frame.join("\n")).toContain("t filter tag");

		for (const line of frame) {
			expect(displayWidth(line)).toBe(120);
		}
	});

	test("classification notes use plain states and exception-only icons", () => {
		const plain = layoutFrame(jevSnapshot, LIST_FOCUS, 72, 12, "plain");
		const ansi = layoutFrame(jevSnapshot, LIST_FOCUS, 72, 12, "ansi");

		const rows = plain.slice(2, 8).join("\n");

		expect(rows).toContain("0.10");
		expect(rows).toContain("0.90");
		expect(rows).toContain("");
		expect(rows).toContain(" failed");
		expect(rows).toContain("");
		expect(rows).not.toContain("pending");
		expect(rows).not.toContain("not requested");
		expect(plain.join("\n")).toContain(" skipped");
		expect(plain.join("\n")).not.toContain("Jev");
		expect(ansi[3]).toContain(rgbSgr(THEME.subtle, "fg"));
		expect(ansi[3]).toContain("low relevance");
		expect(ansi[4]).toContain("high relevance");

		for (const frame of [plain, ansi.map(visibleText)]) {
			for (const line of frame) expect(displayWidth(line)).toBe(72);
		}
	});

	test("Jev mode keeps a compact classification column on narrow terminals", () => {
		const frame = layoutFrame(jevSnapshot, LIST_FOCUS, 40, 12, "plain");
		const text = frame.join("\n");

		expect(text).toContain("0.10");
		expect(text).toContain("");
		expect(text).toContain(" fail");
		expect(text).toContain("");
		expect(text).toContain(" skip");

		for (const line of frame) expect(displayWidth(line)).toBe(40);
	});

	test("row pool size stays bounded to the viewport plus overscan", () => {
		expect(visiblePoolSize(5)).toBe(7);
		expect(visiblePoolSize(21)).toBe(23);

		const rows: ViewRow[] = [
			{
				id: 1,
				selected: true,
				level: "I",
				kind: "header",
				spans: [{ text: "hello", role: "message" }],
				clipped: false,
				classification: NONE_CLASSIFICATION,
			},
		];

		expect(paintLogList(rows)).toEqual([renderRowText(rows[0]!)]);
	});

	test("ansi paint colors the level letter and keeps the selection marker", () => {
		const row: ViewRow = {
			id: 1,
			selected: true,
			level: "E",
			kind: "header",
			spans: [
				{ text: "12:00:00.000", role: "timestamp" },
				{ text: "  ", role: "gutter" },
				{ text: "E", role: "level" },
				{ text: "  boom", role: "message" },
			],
			clipped: false,
			classification: NONE_CLASSIFICATION,
		};

		const ansi = renderRowText(row, "ansi");
		expect(ansi).toContain("▸");
		expect(ansi).toContain(`38;2;${THEME.red[0]};${THEME.red[1]};${THEME.red[2]}m`);
		expect(ansi).toContain("E");
		expect(renderRowText(row, "plain")).not.toContain("\u001b");
		expect(paintStyleFromEnv("1", undefined)).toBe("plain");
		expect(paintStyleFromEnv(undefined, undefined)).toBe("ansi");
	});

	test("decodes terminal keys used by the list and filter editor", () => {
		expect(decodeTerminalKey("\u001b[A")).toEqual({ key: "up", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b[B")).toEqual({ key: "down", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b[5~")).toEqual({ key: "pageup", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b[6~")).toEqual({ key: "pagedown", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b[H")).toEqual({ key: "home", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b[F")).toEqual({ key: "end", ctrl: false, shift: false });
		expect(decodeTerminalKey("G")).toEqual({ key: "G", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u0003")).toEqual({ key: "c", ctrl: true, shift: false });
		expect(decodeTerminalKey("\u0004")).toEqual({ key: "d", ctrl: true, shift: false });
		expect(decodeTerminalKey("\u0015")).toEqual({ key: "u", ctrl: true, shift: false });
		expect(decodeTerminalKey("\t")).toEqual({ key: "tab", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b")).toEqual({ key: "escape", ctrl: false, shift: false });
	});

	test("decodes a multi-key burst in one chunk", () => {
		const decoded = decodeTerminalInput("Database");

		expect(decoded.rest).toBe("");
		expect(decoded.keys.map((key) => key.key).join("")).toBe("Database");
		expect(decoded.keys.every((key) => key.ctrl === false && key.shift === false)).toBe(true);
	});

	test("decodes an up-arrow when Escape and CSI bytes arrive separately", () => {
		const decoder = new TerminalInputDecoder();
		const first = decoder.push("\u001b");

		expect(first.keys).toEqual([]);
		expect(first.rest).toBe("\u001b");

		const second = decoder.push("[A");
		expect(second.keys).toEqual([{ key: "up", ctrl: false, shift: false }]);
		expect(second.rest).toBe("");
	});

	test("keeps UTF-8 text split between stdin chunks", () => {
		const decoder = new TerminalInputDecoder();
		expect(decoder.push(new Uint8Array([0xc3])).keys).toEqual([]);
		expect(decoder.push(new Uint8Array([0xa9])).keys).toEqual([
			{ key: "é", ctrl: false, shift: false },
		]);
	});

	test("flushes a standalone Escape after the sequence delay", () => {
		const decoder = new TerminalInputDecoder();
		decoder.push("\u001b");
		expect(decoder.flush()).toEqual([{ key: "escape", ctrl: false, shift: false }]);
		expect(decodeTerminalInput("\u001b")).toEqual({
			keys: [{ key: "escape", ctrl: false, shift: false }],
			rest: "",
		});
	});
});
