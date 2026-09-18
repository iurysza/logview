import {
	LIST_FOCUS,
	reduceInteraction,
	type InteractionState,
	type ViewRow,
} from "@logview/core";
import { err, ok, type Result } from "@logview/core";
import type { Session, SessionSnapshot, TerminalAttachment, UiError } from "@logview/engine";
import { MOCHA, type Rgb } from "./catppuccin.ts";
import { paintChrome, paintRow, paintStyleFromEnv, screenPrelude, type PaintStyle } from "./color.ts";

export const ROW_POOL_OVERSCAN = 2;

export function formatStatus(snapshot: SessionSnapshot): string {
	let source = "SOURCE IDLE";

	if (snapshot.source.kind === "running") source = "SOURCE RUNNING";
	else if (snapshot.source.kind === "starting") source = "SOURCE STARTING";
	else if (snapshot.source.kind === "ended" && snapshot.source.reason === "eof") source = "SOURCE ENDED";
	else if (snapshot.source.kind === "ended") source = "SOURCE STOPPED";
	else if (snapshot.source.kind === "failed") source = "SOURCE FAILED";

	const line = `logview · ${snapshot.sessionId} · ${source}`;

	return line;
}

function statusColor(snapshot: SessionSnapshot): Rgb {
	if (snapshot.source.kind === "failed") return MOCHA.red;

	if (snapshot.source.kind === "running") return MOCHA.green;

	if (snapshot.source.kind === "ended") return MOCHA.overlay1;

	return MOCHA.overlay1;
}

function paintStatus(snapshot: SessionSnapshot, style: PaintStyle): string {
	const raw = formatStatus(snapshot);

	if (style === "plain") return raw;

	const parts = raw.split(" · ");
	const title = paintChrome(parts[0] ?? "logview", MOCHA.lavender, style);
	const session = paintChrome(parts[1] ?? "", MOCHA.subtext0, style);
	const source = paintChrome(parts[2] ?? "", statusColor(snapshot), style);
	const dot = paintChrome(" · ", MOCHA.overlay0, style);

	return `${title}${dot}${session}${dot}${source}`;
}

export function formatFilter(snapshot: SessionSnapshot): string {
	const filter = snapshot.activeFilter;

	return `Level: ${filter.minLevel ?? "ALL"}   Tag: ${filter.tag ?? "—"}   PID: ${filter.pid ?? "—"}   Text: ${filter.text || "—"}`;
}

export function formatFooter(snapshot: SessionSnapshot): string {
	let extra = "";

	if (snapshot.notice === "history-expired") extra = " · Earlier history expired";
	else if (snapshot.notice === "applying-filter") extra = " · Applying filters";
	else if (snapshot.notice === "resize-required") extra = " · Resize terminal";
	else if (snapshot.stats.lagging) extra = " · Catching up";

	const mode = snapshot.view.mode.toUpperCase();
	const rest = ` · ${snapshot.view.newSincePause} new since pause · ${snapshot.stats.matchedEvents} matches · ${snapshot.stats.retainedEvents} retained${extra}`;

	return `${mode}${rest}`;
}

function modeColor(snapshot: SessionSnapshot): Rgb {
	if (snapshot.view.mode === "browse") return MOCHA.yellow;

	return MOCHA.green;
}

function paintFilterLine(snapshot: SessionSnapshot, style: PaintStyle): string {
	if (style === "plain") return formatFilter(snapshot);

	const filter = snapshot.activeFilter;
	const all = filter.minLevel ?? "ALL";
	const tagValue = filter.tag ?? "—";
	const pidValue = filter.pid === null ? "—" : String(filter.pid);
	const textValue = filter.text || "—";
	const level = paintChrome("Level: ", MOCHA.overlay1, style) + paintChrome(all, filter.minLevel ? MOCHA.yellow : MOCHA.overlay2, style);
	const tag = paintChrome("Tag: ", MOCHA.overlay1, style) + paintChrome(tagValue, filter.tag ? MOCHA.green : MOCHA.overlay2, style);
	const pid = paintChrome("PID: ", MOCHA.overlay1, style) + paintChrome(pidValue, filter.pid === null ? MOCHA.overlay2 : MOCHA.teal, style);
	const text = paintChrome("Text: ", MOCHA.overlay1, style) + paintChrome(textValue, filter.text ? MOCHA.peach : MOCHA.overlay2, style);

	return `${level}   ${tag}   ${pid}   ${text}`;
}

export function formatHints(): string {
	return "↑↓ move   PgUp/PgDn page   G tail   / text   f filters   q quit";
}

export function renderRowText(row: ViewRow, style: PaintStyle = "plain"): string {
	return paintRow(row, style);
}

function layoutLines(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	style: PaintStyle,
): readonly string[] {
	if (snapshot.notice === "resize-required") {
		return ["Terminal too small. Resize to at least 40x8. Ingestion continues."];
	}

	const status = paintStatus(snapshot, style);
	const lines = [status, paintFilterLine(snapshot, style)];

	if (interaction.focus === "filters") {
		const error = interaction.error ? `  ! ${interaction.error.message}` : "";
		const editor = `Edit ${interaction.field}: ${interaction.draft[interaction.field]}${error}`;
		lines.push(interaction.error ? paintChrome(editor, MOCHA.red, style) : paintChrome(editor, MOCHA.peach, style));
	}

	for (const row of snapshot.rows) lines.push(paintRow(row, style));

	const footer = formatFooter(snapshot);
	const mode = snapshot.view.mode.toUpperCase();

	const paintedFooter = footer.startsWith(mode)
		? `${paintChrome(mode, modeColor(snapshot), style)}${paintChrome(footer.slice(mode.length), MOCHA.subtext0, style)}`
		: paintChrome(footer, MOCHA.subtext0, style);

	lines.push(paintedFooter);
	lines.push(paintChrome(formatHints(), MOCHA.overlay0, style));

	return lines;
}

export function layoutSession(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	style: PaintStyle = "plain",
): readonly string[] {
	return layoutLines(snapshot, interaction, style);
}

type KeyCommand = Readonly<{
	key: string;
	ctrl: boolean;
	shift: boolean;
}>;

function decodeChunk(chunk: Uint8Array | string): string {
	if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);

	return chunk;
}

function keyFromText(text: string): KeyCommand | null {
	if (text === "\u0003") return { key: "c", ctrl: true, shift: false };

	if (text === "\u001b") return { key: "escape", ctrl: false, shift: false };

	if (text === "\r" || text === "\n") return { key: "enter", ctrl: false, shift: false };

	if (text === "\t") return { key: "tab", ctrl: false, shift: false };

	if (text === "\u001b[Z") return { key: "tab", ctrl: false, shift: true };

	if (text === "\u007f" || text === "\b") return { key: "backspace", ctrl: false, shift: false };

	if (text === "\u001b[A") return { key: "up", ctrl: false, shift: false };

	if (text === "\u001b[B") return { key: "down", ctrl: false, shift: false };

	if (text === "\u001b[5~") return { key: "pageup", ctrl: false, shift: false };

	if (text === "\u001b[6~") return { key: "pagedown", ctrl: false, shift: false };

	if (text === "\u001b[H" || text === "\u001b[1~") return { key: "home", ctrl: false, shift: false };

	if (text === "\u001b[F" || text === "\u001b[4~") return { key: "end", ctrl: false, shift: false };

	if (text.length === 1) return { key: text, ctrl: false, shift: false };

	return null;
}

export function decodeTerminalKey(text: string): KeyCommand | null {
	return keyFromText(text);
}

export async function attachTui(
	session: Session,
): Promise<Result<TerminalAttachment & { done: Promise<void> }, UiError>> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return err({ kind: "setup-failed", message: "no TTY available" });
	}

	let interaction: InteractionState = LIST_FOCUS;
	let closed = false;
	let resolveDone: () => void = () => undefined;

	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	const wasRaw = process.stdin.isRaw;
	const style = paintStyleFromEnv(process.env.NO_COLOR, process.env.FORCE_COLOR);
	process.stdin.setRawMode?.(true);
	process.stdin.resume();
	process.stdout.write(`\x1b[?1049h\x1b[?25l${screenPrelude()}\x1b[2J`);

	const paint = (snapshot: SessionSnapshot): void => {
		const lines = layoutLines(snapshot, interaction, style);
		let frame = `\x1b[H${screenPrelude()}`;

		for (const line of lines) frame += `${line}\x1b[K\r\n`;

		process.stdout.write(frame);
	};

	const unsubscribe = session.subscribe(paint);
	paint(session.snapshot());

	const onData = (chunk: Uint8Array | string): void => {
		const mapped = keyFromText(decodeChunk(chunk));

		if (!mapped) return;

		const result = reduceInteraction(
			interaction,
			{ kind: "key", key: mapped.key, ctrl: mapped.ctrl, shift: mapped.shift },
			session.snapshot().activeFilter,
		);

		interaction = result.state;

		if (result.command) session.dispatch(result.command);
		else paint(session.snapshot());

		if (result.quit) void shutdown();
	};

	const onResize = (): void => {
		session.dispatch({
			kind: "resize",
			columns: process.stdout.columns ?? 80,
			rows: process.stdout.rows ?? 24,
		});
	};

	process.stdin.on("data", onData);
	process.stdout.on("resize", onResize);

	async function shutdown(): Promise<void> {
		if (closed) return;

		closed = true;
		unsubscribe();
		process.stdin.off("data", onData);
		process.stdout.off("resize", onResize);
		process.stdin.setRawMode?.(wasRaw ?? false);
		process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
		resolveDone();
	}

	return ok({ done, close: shutdown });
}

export { ROW_POOL_OVERSCAN as OVERSCAN };
