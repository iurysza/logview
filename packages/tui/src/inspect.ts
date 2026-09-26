import {
	displayWidth,
	escapeDisplayText,
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

function inspectTimestamp(epochMicros: number): string {
	return new Date(Math.floor(epochMicros / 1000)).toISOString().replace("T", " ").replace("Z", "");
}

function wrapDisplayText(text: string, width: number): string[] {
	if (width <= 0) return [""];

	const lines: string[] = [];
	let line = "";
	let used = 0;

	for (const unit of escapeDisplayText(text)) {
		if (unit.width > 0 && used + unit.width > width) {
			lines.push(line);
			line = "";
			used = 0;
		}

		line += unit.display;
		used += unit.width;
	}

	if (line.length > 0 || lines.length === 0) lines.push(line);

	return lines;
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

function stackLine(line: string): ChromeLine {
	const clean = sanitizeDisplay(line).trim();
	const frame = /^(at\s+.+?)(\([^()]*\))$/.exec(clean);

	if (frame) {
		return [span("│  ", THEME.subtle), span(frame[1]!, THEME.text), span(frame[2]!, THEME.cyan)];
	}

	const cause = /^(Caused by:|Suppressed:)(.*)$/.exec(clean);

	if (cause) {
		return [span("├─ ", THEME.subtle), span(cause[1]!, THEME.purple, { bold: true }), span(cause[2]!, THEME.text)];
	}

	if (/^\.\.\. \d+ more$/.test(clean)) {
		return [span("│  ", THEME.subtle), span(clean, THEME.muted)];
	}

	return [span("│  ", THEME.subtle), span(clean, THEME.text)];
}

function continuationLine(line: string): ChromeLine {
	return [span("│  ", THEME.subtle), span(sanitizeDisplay(line), THEME.muted)];
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
		lines.push(field("Package", packageLabel(attribution), attribution.kind === "unavailable" ? THEME.amber : THEME.text));
		lines.push(field("Tag", sanitizeDisplay(tagText(event.rawText, metadata.tag)), THEME.green));

		if (classification) lines.push(field("Jev", classification, THEME.purple));

		lines.push(section("Message", width));

		for (const messageLine of wrapDisplayText(messageText(event.rawText, metadata.message), width)) {
			lines.push([{ text: messageLine, style: severityStyle(metadata.level) }]);
		}
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

		lines.push(section(title, width));

		for (const line of event.continuations) {
			lines.push(isStackTrace ? stackLine(line) : continuationLine(line));
		}
	}

	lines.push(section("Raw", width));
	lines.push([span(sanitizeDisplay(event.rawText), THEME.subtle)]);

	for (const line of event.continuations) lines.push([span(sanitizeDisplay(line), THEME.subtle)]);

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
