import {
	displayWidth,
	messageText,
	sanitizeDisplay,
	tagText,
	type LogEvent,
	type LogLevel,
} from "@logcayo/core";
import type { PackageAttribution } from "@logcayo/engine";
import type { Rgb } from "./catppuccin.ts";
import { type ChromeLine, type ChromeSpan, paintChromeLine } from "./chrome.ts";
import type { PaintStyle } from "./color.ts";
import { severityStyle, THEME } from "./theme.ts";
import { wrapChromeLine } from "./wrap.ts";

const LABEL_WIDTH = 12;

const LEVEL_NAMES: Readonly<Record<LogLevel, string>> = {
	V: "VERBOSE",
	D: "DEBUG",
	I: "INFO",
	W: "WARN",
	E: "ERROR",
	F: "FATAL",
};

function span(
	text: string,
	color = THEME.text,
	options: Readonly<{ bold?: boolean; background?: Rgb }> = {},
): ChromeSpan {
	return {
		text,
		style: {
			fg: color,
			bg: options.background ?? null,
			bold: options.bold === true,
			italic: false,
		},
	};
}

function field(label: string, value: string, color = THEME.text, bold = false): ChromeLine {
	return [span(label.padEnd(LABEL_WIDTH), THEME.muted), span(value, color, { bold })];
}

function section(label: string, width: number): ChromeLine {
	const ruleWidth = Math.max(0, width - displayWidth(label) - 1);

	return [
		span(label, THEME.accent, { bold: true }),
		span(" ", THEME.subtle),
		span("─".repeat(ruleWidth), THEME.subtle),
	];
}

const GUTTER: ChromeLine = [span("│  ", THEME.subtle)];

const GUTTER_CONTINUATION: ChromeLine = [span("│    ", THEME.subtle)];

const CAUSE_MARK: ChromeLine = [span("├─ ", THEME.subtle)];

const RAW_WRAP: ChromeLine = [span("  ", THEME.subtle)];

const RAW_CONTINUATION_WRAP: ChromeLine = [span("    ", THEME.subtle)];

function inspectTimestamp(epochMicros: number): string {
	return new Date(Math.floor(epochMicros / 1000)).toISOString().replace("T", " ").replace("Z", "");
}

function pushWrapped(
	lines: ChromeLine[],
	content: ChromeLine,
	width: number,
	firstPrefix: ChromeLine,
	restPrefix: ChromeLine,
): void {
	for (const row of wrapChromeLine(content, width, firstPrefix, restPrefix)) lines.push(row);
}

function isStackFrame(line: string): boolean {
	return /^\s*at\s+.+\([^()]*\)\s*$/.test(line);
}

function isStackTraceLine(line: string): boolean {
	return isStackFrame(line)
		|| /^\s*(?:Caused by:|Suppressed:)/.test(line)
		|| /^\s*\.\.\. \d+ more\s*$/.test(line)
		|| /^\s*[\w.$]+(?:Exception|Error)(?::|$)/.test(line);
}

function appendContinuation(lines: ChromeLine[], line: string, width: number): void {
	pushWrapped(lines, [span(line, THEME.muted)], width, GUTTER, GUTTER_CONTINUATION);
}

function appendStackLine(lines: ChromeLine[], line: string, width: number): void {
	const clean = sanitizeDisplay(line).trim();
	const frame = /^(at\s+.+?)(\([^()]*\))$/.exec(clean);

	if (frame) {
		pushWrapped(lines, [span(frame[1]!, THEME.text), span(frame[2]!, THEME.cyan)], width, GUTTER, GUTTER_CONTINUATION);

		return;
	}

	const cause = /^(Caused by:|Suppressed:)(.*)$/.exec(clean);

	if (cause) {
		pushWrapped(
			lines,
			[span(cause[1]!, THEME.purple, { bold: true }), span(cause[2]!, THEME.text)],
			width,
			CAUSE_MARK,
			GUTTER_CONTINUATION,
		);

		return;
	}

	const color = /^\.\.\. \d+ more$/.test(clean) ? THEME.muted : THEME.text;

	pushWrapped(lines, [span(clean, color)], width, GUTTER, GUTTER_CONTINUATION);
}

function appendRawHead(lines: ChromeLine[], text: string, width: number): void {
	pushWrapped(lines, [span(text.trimStart(), THEME.subtle)], width, [], RAW_WRAP);
}

function appendRawContinuation(lines: ChromeLine[], text: string, width: number): void {
	pushWrapped(lines, [span(text.trimStart(), THEME.subtle)], width, RAW_WRAP, RAW_CONTINUATION_WRAP);
}

function packageColor(attribution: PackageAttribution): Rgb {
	if (attribution.kind === "unavailable" || attribution.kind === "resolving") return THEME.muted;

	return THEME.text;
}

function pushSection(lines: ChromeLine[], label: string, width: number): void {
	lines.push([]);
	lines.push(section(label, width));
}

function action(key: string, label: string, value = ""): ChromeLine {
	return [
		span(` ${key} `, THEME.text, { bold: true, background: THEME.chip }),
		span(` ${label}`, THEME.muted),
		span(value.length > 0 ? ` ${value}` : "", THEME.text),
	];
}

function packageLabel(attribution: PackageAttribution): string {
	if (attribution.kind === "resolving") return "Resolving";

	if (attribution.kind === "unavailable") return attribution.reason === "not-recorded" ? "Not recorded" : "Unavailable";

	if (attribution.kind === "resolved") {
		if (attribution.packages.length === 0) return `UID ${attribution.uid} (no package)`;

		return attribution.packages.join(", ");
	}

	return "Unavailable";
}

function inspectorContent(
	event: LogEvent | null,
	width: number,
	classification: string | null,
	attribution: PackageAttribution,
): ChromeLine[] {
	if (!event) return [[span("No event selected", THEME.muted)]];

	const lines: ChromeLine[] = [];

	if (event.metadata) {
		const metadata = event.metadata;

		lines.push(field("Timestamp", inspectTimestamp(metadata.epochMicros)));
		lines.push([
			span("Level".padEnd(LABEL_WIDTH), THEME.muted),
			{ text: `${LEVEL_NAMES[metadata.level]} (${metadata.level})`, style: severityStyle(metadata.level) },
		]);

		const process = metadata.uid == null
			? `PID ${metadata.pid} · TID ${metadata.tid}`
			: `UID ${metadata.uid} · PID ${metadata.pid} · TID ${metadata.tid}`;

		lines.push(field("Process", process, THEME.cyan));
		lines.push(field("Package", packageLabel(attribution), packageColor(attribution)));
		lines.push(field("Tag", sanitizeDisplay(tagText(event.rawText, metadata.tag)), THEME.green));

		if (classification) lines.push(field("Jev", classification, THEME.purple));

		pushSection(lines, "Message", width);
		pushWrapped(lines, [span(messageText(event.rawText, metadata.message), THEME.text)], width, [], []);
	} else {
		lines.push(field("Format", "Unparsed", THEME.amber));
	}

	if (event.continuations.length > 0) {
		const isStackTrace = event.continuations.some(isStackTraceLine);
		const frameCount = event.continuations.filter(isStackFrame).length;

		const title = isStackTrace
			? frameCount === 0
				? "Stack Trace"
				: `Stack Trace (${frameCount} ${frameCount === 1 ? "frame" : "frames"})`
			: `Continuation (${event.continuations.length} ${event.continuations.length === 1 ? "line" : "lines"})`;

		pushSection(lines, title, width);

		for (const line of event.continuations) {
			if (isStackTrace) appendStackLine(lines, line, width);
			else appendContinuation(lines, line, width);
		}
	}

	pushSection(lines, "Raw", width);
	appendRawHead(lines, event.rawText, width);

	for (const line of event.continuations) appendRawContinuation(lines, line, width);

	return lines;
}

function inspectorActions(event: LogEvent | null, width: number, includeHeading: boolean): ChromeLine[] {
	const lines: ChromeLine[] = includeHeading ? [section("Actions", width)] : [];

	if (event?.metadata) {
		lines.push(action("t", "filter by this tag", `"${sanitizeDisplay(tagText(event.rawText, event.metadata.tag))}"`));
		lines.push(action("p", "filter by this PID", String(event.metadata.pid)));
	}

	lines.push(action("y", "copy event"));

	return lines;
}

export function inspectorWidth(columns: number): number {
	return Math.min(56, Math.max(40, Math.floor(columns * 0.4)));
}

export function inspectorHeader(event: LogEvent | null, width: number): ChromeLine {
	const title = "Event Details";
	const reference = event ? `#${event.id}` : "";
	const gap = Math.max(1, width - displayWidth(title) - displayWidth(reference));

	return [
		span(title, THEME.accent, { bold: true }),
		span(" ".repeat(gap), THEME.muted),
		span(reference, THEME.muted),
	];
}

export function paintInspector(
	event: LogEvent | null,
	width: number,
	height: number,
	style: PaintStyle,
	classification: string | null = null,
	attribution: PackageAttribution = { kind: "idle" },
): string[] {
	const rows = Math.max(1, height);
	const actions = inspectorActions(event, width, rows >= 16);
	const actionRows = Math.min(actions.length, rows);
	const contentRows = Math.max(0, rows - actionRows);
	const content = inspectorContent(event, width, classification, attribution);
	const lines: string[] = [];

	for (let i = 0; i < contentRows; i += 1) {
		lines.push(paintChromeLine(content[i] ?? [], width, style, THEME.bar));
	}

	for (let i = actions.length - actionRows; i < actions.length; i += 1) {
		lines.push(paintChromeLine(actions[i]!, width, style, THEME.bar));
	}

	return lines;
}
