import {
	clipToWidth,
	completeQuery,
	displayWidth,
	EMPTY_CANDIDATES,
	formatQuery,
	LIST_FOCUS,
	parseQuery,
	type QueryCandidates,
	type FilterSpec,
	type InteractionState,
	type QueryError,
	type SearchMode,
} from "@logview/core";
import { type SessionSnapshot as EngineSessionSnapshot } from "@logview/engine";
import { paintStyled, rgbSgr, styleOn, type CellStyle, type Rgb } from "./catppuccin.ts";
import { type PaintStyle } from "./color.ts";
import { severityStyle, THEME } from "./theme.ts";

export type ChromeSpan = Readonly<{ text: string; style: CellStyle }>;

export type ChromeLine = readonly ChromeSpan[];

export type KeyHint = Readonly<{ key: string; label: string }>;

type Snapshot = EngineSessionSnapshot;

const plain = (text: string, color: Rgb = THEME.text): ChromeSpan => ({
	text,
	style: { fg: color, bg: null, bold: false, italic: false },
});

const bold = (text: string, color: Rgb = THEME.text, background: Rgb | null = null): ChromeSpan => ({
	text,
	style: { fg: color, bg: background, bold: true, italic: false },
});

export function paintChromeLine(
	spans: ChromeLine,
	columns: number,
	style: PaintStyle,
	background: Rgb,
): string {
	let remaining = Math.max(0, columns);
	let text = "";

	for (const span of spans) {
		if (remaining <= 0) break;
		const clipped = clipToWidth(span.text, remaining);

		if (clipped.width === 0) continue;
		text += style === "plain"
			? clipped.text
			: paintStyled(clipped.text, styleOn(span.style, span.style.bg ?? background));
		remaining -= clipped.width;
	}

	if (remaining > 0) {
		const padding = " ".repeat(remaining);
		text += style === "plain" ? padding : paintStyled(padding, { fg: THEME.text, bg: background, bold: false, italic: false });
	}

	if (style === "ansi") return `${rgbSgr(background, "bg")}${text}\u001b[0m`;

	return text;
}

export function activeFilterCount(filter: FilterSpec): number {
	return (
		Number(filter.minLevel !== null) +
		Number(filter.tag !== null) +
		Number(filter.pid !== null) +
		Number(filter.packageName != null) +
		Number(filter.text.length > 0)
	);
}

export function sourceStatusText(snapshot: Pick<Snapshot, "sourceKind" | "source">): string {
	const prefix = snapshot.sourceKind === "replay" ? "REPLAY" : "LIVE";

	if (snapshot.source.kind === "failed") return `${prefix} • FAILED`;

	if (snapshot.source.kind === "ended") return `${prefix} • END`;

	if (snapshot.source.kind === "starting") return `${prefix} • STARTING`;

	if (snapshot.source.kind === "running") return `${prefix} • ${snapshot.sourceKind === "replay" ? "PLAYING" : "RUNNING"}`;

	return `${prefix} • IDLE`;
}

export function keyHints(
	interaction: InteractionState,
	searchMode: SearchMode = "text",
	semanticAvailable = false,
): readonly KeyHint[] {
	if (interaction.focus === "filters") {
		return [
			{ key: "Tab", label: "Next" },
			{ key: "Enter", label: "Apply" },
			{ key: "Esc", label: "Cancel" },
			{ key: "^C", label: "Quit" },
		];
	}

	if (interaction.focus === "query") {
		const jev = draftSearchMode(interaction.draft) === "jev";

		return [
			{ key: "Enter", label: jev ? "Ask Jev" : "Done" },
			{ key: "Tab", label: "Complete" },
			...(semanticAvailable && !jev ? [{ key: "~", label: "Ask Jev" }] : []),
			{ key: "↑↓", label: "History" },
			{ key: "Esc", label: "Cancel" },
			{ key: "^C", label: "Quit" },
		];
	}

	if (interaction.focus === "inspect") {
		return [
			{ key: "↑↓", label: "Move" },
			{ key: "Esc", label: "Close" },
			{ key: "?", label: "Help" },
			{ key: "q", label: "Quit" },
		];
	}

	if (interaction.focus === "help") return [{ key: "Esc", label: "Close" }, { key: "q", label: "Quit" }];

	return [
		{ key: "Enter", label: "Inspect" },
		{ key: "/", label: "Query" },
		{ key: "f", label: "Filters" },
		{ key: "x", label: "Clear" },
		{ key: "u", label: "Undo" },
		{ key: "c", label: "Copy query" },
		{ key: "G", label: "Tail" },
		...(semanticAvailable ? [{ key: "m", label: searchMode === "jev" ? "Use text" : "Ask Jev" }] : []),
		{ key: "y", label: "Copy" },
		{ key: "?", label: "Help" },
		{ key: "q", label: "Quit" },
	];
}

export function eventCountLabel(snapshot: Snapshot): string {
	if (activeFilterCount(snapshot.activeFilter) > 0) {
		return `${snapshot.stats.matchedEvents} of ${snapshot.stats.retainedEvents}`;
	}

	return `${snapshot.stats.retainedEvents} events`;
}

export function formatHints(
	interaction: InteractionState = LIST_FOCUS,
	searchMode: SearchMode = "text",
	semanticAvailable = false,
): string {
	return keyHints(interaction, searchMode, semanticAvailable).map((hint) => `${hint.key} ${hint.label}`).join("  ");
}

export function formatStatus(snapshot: Snapshot): string {
	return `logview   ${snapshot.label}   ${sourceStatusText(snapshot)}   ${eventCountLabel(snapshot)}   ${activeFilterCount(snapshot.activeFilter)} filters`;
}

export function formatFilter(snapshot: Snapshot): string {
	const filter = snapshot.activeFilter;

	return [
		filter.minLevel ? `Level: ${filter.minLevel}+` : "Level: all",
		filter.tag ? `Tag: ${filter.tag}` : "Tag: any",
		filter.pid === null ? "PID: any" : `PID: ${filter.pid}`,
		filter.packageName ? `Package: ${filter.packageName}` : "Package: any",
		filter.text ? `${snapshot.searchMode === "jev" ? "Jev: ~" : "Text: /"} ${filter.text}` : "Text: /",
	].join("  ");
}

function displayBadge(snapshot: Snapshot, interaction: InteractionState): string {
	if (interaction.focus === "filters") return "FILTER";

	if (interaction.focus === "query") return "QUERY";

	if (interaction.focus === "inspect") return "INSPECT";

	if (interaction.focus === "help") return "HELP";

	if (snapshot.view.mode === "browse") return "BROWSE";

	return "TAIL";
}

function footerNotice(snapshot: Snapshot): string {
	if (snapshot.notice === "applying-filter") return " · applying filters";

	if (snapshot.stats.lagging) return " · catching up";

	if (snapshot.notice === "history-expired") return " · earlier history expired";

	return "";
}

export function formatFooter(snapshot: Snapshot, interaction: InteractionState = LIST_FOCUS): string {
	const badge = displayBadge(snapshot, interaction);
	const unseen = snapshot.view.mode === "browse" && snapshot.view.newSincePause > 0 ? ` · ${snapshot.view.newSincePause} unseen` : "";

	return `${badge}${unseen}${footerNotice(snapshot)}  ${formatHints(interaction, snapshot.searchMode, snapshot.semantic !== null)}`;
}

function fitGroups(groups: readonly ChromeSpan[], columns: number): ChromeSpan[] {
	const out: ChromeSpan[] = [];
	let used = 0;

	for (const group of groups) {
		const width = displayWidth(group.text);

		if (used + width > columns) break;
		out.push(group);
		used += width;
	}

	return out;
}

/** The mode the draft will apply in: `~` before the text asks Jev. */
export function draftSearchMode(draft: string): SearchMode {
	const parsed = parseQuery(draft);

	if (parsed.ok) return parsed.value.searchMode;

	return /(^|\s)~/.test(draft) ? "jev" : "text";
}

const JEV_ERROR_COPY = {
	auth: "API key rejected",
	timeout: "timed out",
	"rate-limited": "rate limited",
	"invalid-response": "bad response",
	unavailable: "unreachable",
} as const;

/** Jev state for the status bar, or null when Jev is not the active search. */
export function jevStatusSpans(snapshot: Snapshot): ChromeSpan[] | null {
	const semantic = snapshot.semantic;

	if (semantic === null || snapshot.searchMode !== "jev" || snapshot.activeFilter.text.length === 0) return null;

	const badge = bold(" ✦ Jev ", THEME.canvas, THEME.purple);

	if (semantic.lastError !== null) return [badge, plain(` ${JEV_ERROR_COPY[semantic.lastError]}`, THEME.red)];

	if (semantic.pendingEvents > 0 || semantic.inFlight > 0) {
		return [badge, plain(` asking · ${semantic.pendingEvents} left`, THEME.muted)];
	}

	return [badge, plain(` ${semantic.relevantEvents} relevant`, THEME.purple)];
}

export function paintStatus(snapshot: Snapshot, columns: number, style: PaintStyle): string {
	let statusColor = THEME.muted;

	if (snapshot.source.kind === "failed") statusColor = THEME.red;

	if (snapshot.source.kind === "running") statusColor = THEME.green;
	const left = [bold("logview", THEME.accent), plain("  "), plain(snapshot.label, THEME.muted)];

	const jev = jevStatusSpans(snapshot);
	const jevGroup = jev === null ? [] : [plain("  "), ...jev];

	const right = [
		plain("  "),
		bold(sourceStatusText(snapshot), statusColor),
		plain("  "),
		plain(eventCountLabel(snapshot), THEME.text),
		...jevGroup,
		plain("  "),
		plain(`${activeFilterCount(snapshot.activeFilter)} filters`, THEME.muted),
	];

	const full = [...left, ...right];

	if (displayWidth(full.map((span) => span.text).join("")) <= columns) return paintChromeLine(full, columns, style, THEME.bar);

	const retained = [
		bold("logview", THEME.accent),
		plain("  "),
		bold(sourceStatusText(snapshot), statusColor),
		plain("  "),
		plain(eventCountLabel(snapshot), THEME.text),
		...jevGroup,
	];

	return paintChromeLine(fitGroups(retained, columns), columns, style, THEME.bar);
}

function filterChip(label: string, active: boolean, color: Rgb = THEME.accent): ChromeSpan {
	return active ? bold(` ${label} `, color, THEME.chip) : plain(` ${label} `, THEME.muted);
}

function textChip(text: string, searchMode: SearchMode): ChromeSpan {
	if (text.length === 0) return filterChip("Text /", false);

	if (searchMode === "jev") return bold(` ✦ Jev ${text} `, THEME.canvas, THEME.purple);

	return filterChip(`Text / ${text}`, true, THEME.accent);
}

function queryEditorSpans(
	draft: string,
	cursor: number,
	error: QueryError | null,
	candidates: QueryCandidates,
	semanticAvailable: boolean,
): ChromeSpan[] {
	const chars = [...draft];
	const index = Math.min(Math.max(cursor, 0), chars.length);
	const atCursor = chars[index];
	const jev = draftSearchMode(draft) === "jev";
	const completion = error === null || error.field !== "text" ? completeQuery(draft, index, candidates) : null;
	const ghost = [...(completion?.ghost ?? "")];

	const spans: ChromeSpan[] = [
		jev ? bold(" ✦ Jev ", THEME.canvas, THEME.purple) : bold(" / ", THEME.canvas, THEME.accent),
		plain(" "),
		plain(chars.slice(0, index).join(""), THEME.text),
	];

	if (atCursor === undefined && ghost.length > 0) {
		spans.push(bold(ghost[0]!, THEME.canvas, THEME.subtle), plain(ghost.slice(1).join(""), THEME.subtle));
	} else {
		spans.push(bold(atCursor ?? " ", THEME.canvas, jev ? THEME.purple : THEME.accent));
		spans.push(plain(ghost.join(""), THEME.subtle));
	}

	if (atCursor !== undefined) spans.push(plain(chars.slice(index + 1).join(""), THEME.text));

	if (error) spans.push(plain(`  ! ${error.message}`, THEME.red));
	else if (jev) spans.push(plain("   Enter asks Jev", THEME.muted));
	else if (completion !== null && completion.alternatives.length > 0) {
		spans.push(plain(`   ${completion.alternatives.join("  ")}`, THEME.subtle));
	} else if (draft.length === 0) {
		spans.push(plain(semanticAvailable ? "type to filter · ~question asks Jev" : "type to filter · Tab completes", THEME.subtle));
	}

	return spans;
}

export function emptyMatchCopy(snapshot: Snapshot): readonly [string, string] | null {
	if (snapshot.rows.length > 0 || snapshot.stats.retainedEvents === 0 || snapshot.notice === "applying-filter") return null;

	if (activeFilterCount(snapshot.activeFilter) === 0) return null;

	return [`No events match ${formatQuery(snapshot.activeFilter, snapshot.searchMode)}`, "x clear · u undo"];
}

export function paintFilterLine(
	snapshot: Snapshot,
	interaction: InteractionState,
	columns: number,
	style: PaintStyle,
	candidates: QueryCandidates = EMPTY_CANDIDATES,
): string {
	if (interaction.focus === "query") {
		const spans = queryEditorSpans(interaction.draft, interaction.cursor, interaction.error, candidates, snapshot.semantic !== null);

		return paintChromeLine(spans, columns, style, THEME.bar);
	}

	if (interaction.focus === "filters") {
		const names = { minLevel: "Level", tag: "Tag", pid: "PID", packageName: "Package", text: "Text" } as const;
		const draft = interaction.draft[interaction.field];
		const error = interaction.error ? `  ! ${interaction.error.message}` : "";

		return paintChromeLine(
			[bold(`Edit ${names[interaction.field]}: `, interaction.error ? THEME.red : THEME.accent), plain(draft, THEME.text), plain(error, THEME.red)],
			columns,
			style,
			THEME.bar,
		);
	}

	const filter = snapshot.activeFilter;

	const spans = [
		filterChip(filter.minLevel ? `Level ${filter.minLevel}+` : "Level all", filter.minLevel !== null, filter.minLevel ? severityStyle(filter.minLevel).fg : THEME.accent),
		plain(" "),
		filterChip(filter.tag ? `Tag ${filter.tag}` : "Tag any", filter.tag !== null),
		plain(" "),
		filterChip(filter.pid === null ? "PID any" : `PID ${filter.pid}`, filter.pid !== null, THEME.cyan),
		plain(" "),
		filterChip(filter.packageName ? `Package ${filter.packageName}` : "Package any", filter.packageName !== null, THEME.green),
		plain(" "),
		textChip(filter.text, snapshot.searchMode),
	];

	if (snapshot.notice === "applying-filter") spans.push(plain("  applying", THEME.amber));

	return paintChromeLine(fitGroups(spans, columns), columns, style, THEME.bar);
}

export function paintFooter(snapshot: Snapshot, interaction: InteractionState, columns: number, style: PaintStyle): string {
	const badge = displayBadge(snapshot, interaction);
	const badgeColor = badge === "BROWSE" ? THEME.amber : THEME.accent;
	const badgeSpan = bold(` ${badge} `, THEME.canvas, badgeColor);
	const hints = keyHints(interaction, snapshot.searchMode, snapshot.semantic !== null);
	const quit = hints.at(-1)!;
	const optional = hints.slice(0, -1);

	const hintSpans = (values: readonly KeyHint[]): ChromeSpan[] => values.flatMap((hint) => [
		plain("  "),
		bold(` ${hint.key} `, THEME.text, THEME.chip),
		plain(` ${hint.label}`, THEME.muted),
	]);

	const fits = (spans: readonly ChromeSpan[]): boolean => displayWidth(spans.map((span) => span.text).join("")) <= columns;
	let visibleOptional = optional;
	let spans = [badgeSpan, ...hintSpans([...visibleOptional, quit])];

	while (visibleOptional.length > 0 && !fits(spans)) {
		visibleOptional = visibleOptional.slice(0, -1);
		spans = [badgeSpan, ...hintSpans([...visibleOptional, quit])];
	}

	if (!fits(spans)) spans = [badgeSpan, ...hintSpans([quit])];

	return paintChromeLine(spans, columns, style, THEME.bar);
}
