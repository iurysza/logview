import { describe, expect, test } from "bun:test";
import { LIST_FOCUS, displayWidth, type ViewRow } from "@logview/core";
import type { SessionSnapshot } from "@logview/engine";
import { EMPTY_FILTER, EMPTY_VIEW } from "@logview/core";
import {
	decodeTerminalKey,
	formatFilter,
	formatFooter,
	formatHints,
	formatStatus,
	layoutFrame,
	layoutSession,
	renderRowText,
} from "../src/app.ts";
import { paintStyleFromEnv } from "../src/color.ts";
import { MOCHA } from "../src/catppuccin.ts";
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
	notice: null,
};

describe("tui chrome", () => {
	test("formats status, filters, footer, and hints without a renderer", () => {
		expect(formatStatus(snapshot)).toContain("REPLAY • END");
		expect(formatFilter(snapshot)).toContain("tag:*");
		expect(formatFooter(snapshot)).toContain("REPLAY");
		expect(formatHints()).toContain("q quit");
		expect(layoutSession(snapshot, LIST_FOCUS).join("\n")).toContain("q quit");
	});

	test("layoutFrame paints exactly rows by columns in plain mode", () => {
		const frame = layoutFrame(snapshot, LIST_FOCUS, 72, 16, "plain");
		expect(frame).toHaveLength(16);

		for (const line of frame) {
			expect(displayWidth(line)).toBe(72);
		}
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
		};

		const ansi = renderRowText(row, "ansi");
		expect(ansi).toContain("▸");
		expect(ansi).toContain(`38;2;${MOCHA.red[0]};${MOCHA.red[1]};${MOCHA.red[2]}m`);
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
		expect(decodeTerminalKey("\t")).toEqual({ key: "tab", ctrl: false, shift: false });
		expect(decodeTerminalKey("\u001b")).toEqual({ key: "escape", ctrl: false, shift: false });
	});
});
