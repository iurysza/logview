import { describe, expect, test } from "bun:test";
import { formatFilter, formatFooter, formatHints, formatStatus, renderRowText } from "../src/app.ts";
import { paintLogList, visiblePoolSize } from "../src/log-list.ts";
import type { SessionSnapshot } from "@logview/engine";
import { EMPTY_FILTER, EMPTY_VIEW, type ViewRow } from "@logview/core";

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
});
