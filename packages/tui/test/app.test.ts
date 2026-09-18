import { describe, expect, test } from "bun:test";
import { LIST_FOCUS } from "@logview/core";
import type { SessionSnapshot } from "@logview/engine";
import { EMPTY_FILTER, EMPTY_VIEW, type ViewRow } from "@logview/core";
import {
	decodeTerminalKey,
	formatFilter,
	formatFooter,
	formatHints,
	formatStatus,
	layoutSession,
	renderRowText,
} from "../src/app.ts";
import { paintLogList, visiblePoolSize } from "../src/log-list.ts";

const snapshot: SessionSnapshot = {
	sessionId: "demo",
	revision: 1,
	source: { kind: "running" },
	sourceNotices: [],
	activeFilter: EMPTY_FILTER,
	activeFilterRevision: 0,
	pendingFilter: null,
	view: EMPTY_VIEW,
	rows: [],
	stats: {
		receivedBytes: 0,
		admittedEvents: 0,
		retainedEvents: 0,
		matchedEvents: 0,
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
		expect(formatStatus(snapshot)).toContain("SOURCE RUNNING");
		expect(formatFilter(snapshot)).toContain("Level: ALL");
		expect(formatFooter(snapshot)).toContain("TAIL");
		expect(formatHints()).toContain("q quit");
		expect(layoutSession(snapshot, LIST_FOCUS).join("\n")).toContain("q quit");
	});

	test("row pool size stays bounded to the viewport plus overscan", () => {
		expect(visiblePoolSize(5)).toBe(7);
		expect(visiblePoolSize(21)).toBe(23);

		const rows: ViewRow[] = [
			{
				id: 1,
				selected: true,
				level: "I",
				spans: [{ text: "hello", role: "message" }],
				clipped: false,
			},
		];

		expect(paintLogList(rows)).toEqual([renderRowText(rows[0]!)]);
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
