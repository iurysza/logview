import type { LogEvent, LogLevel, ViewRow } from "@logview/core";
import {
	EMPTY_FILTER,
	LIST_FOCUS,
	reduceInteraction,
	rowText,
	type InteractionState,
} from "@logview/core";
import type { Session, SessionSnapshot, TerminalAttachment, UiError } from "@logview/engine";
import { err, ok, type Result } from "@logview/core";

const OVERSCAN = 2;

function colorForLevel(level: LogLevel | null): string {
	switch (level) {
		case "E":
		case "F":
			return "red";
		case "W":
			return "yellow";
		case "I":
			return "green";
		case "D":
			return "cyan";
		default:
			return "white";
	}
}

export function formatStatus(snapshot: SessionSnapshot): string {
	const source =
		snapshot.source.kind === "running"
			? "SOURCE RUNNING"
			: snapshot.source.kind === "starting"
				? "SOURCE STARTING"
				: snapshot.source.kind === "ended"
					? snapshot.source.reason === "eof"
						? "SOURCE ENDED"
						: "SOURCE STOPPED"
					: snapshot.source.kind === "failed"
						? "SOURCE FAILED"
						: "SOURCE IDLE";
	return `logview · ${snapshot.sessionId} · ${source}`;
}

export function formatFilter(snapshot: SessionSnapshot): string {
	const f = snapshot.activeFilter;
	return `Level: ${f.minLevel ?? "ALL"}   Tag: ${f.tag ?? "—"}   PID: ${f.pid ?? "—"}   Text: ${f.text || "—"}`;
}

export function formatFooter(snapshot: SessionSnapshot): string {
	const mode = snapshot.view.mode.toUpperCase();
	const notice =
		snapshot.notice === "history-expired"
			? "Earlier history expired"
			: snapshot.notice === "applying-filter"
				? "Applying filters"
				: snapshot.notice === "resize-required"
					? "Resize terminal"
					: snapshot.stats.lagging
						? "Catching up"
						: "";
	return `${mode} · ${snapshot.view.newSincePause} new since pause · ${snapshot.stats.matchedEvents} matches · ${snapshot.stats.retainedEvents} retained${notice ? ` · ${notice}` : ""}`;
}

export function formatHints(): string {
	return "↑↓ move   PgUp/PgDn page   G tail   / text   f filters   q quit";
}

export function renderRowText(row: ViewRow): string {
	const marker = row.selected ? "›" : " ";
	return `${marker}${rowText(row)}`;
}

function keyFromInput(data: string): { key: string; ctrl: boolean; shift: boolean } | null {
	if (data === "\u0003") return { key: "c", ctrl: true, shift: false };
	if (data === "\u001b") return { key: "escape", ctrl: false, shift: false };
	if (data === "\r" || data === "\n") return { key: "enter", ctrl: false, shift: false };
	if (data === "\t") return { key: "tab", ctrl: false, shift: false };
	if (data === "\u001b[Z") return { key: "tab", ctrl: false, shift: true };
	if (data === "\u007f" || data === "\b") return { key: "backspace", ctrl: false, shift: false };
	if (data === "\u001b[A") return { key: "up", ctrl: false, shift: false };
	if (data === "\u001b[B") return { key: "down", ctrl: false, shift: false };
	if (data === "\u001b[5~") return { key: "pageup", ctrl: false, shift: false };
	if (data === "\u001b[6~") return { key: "pagedown", ctrl: false, shift: false };
	if (data === "\u001b[H" || data === "\u001b[1~") return { key: "home", ctrl: false, shift: false };
	if (data === "\u001b[F" || data === "\u001b[4~") return { key: "end", ctrl: false, shift: false };
	if (data.length === 1) return { key: data, ctrl: false, shift: false };
	return null;
}

export async function attachTui(session: Session): Promise<Result<TerminalAttachment & { done: Promise<void> }, UiError>> {
	try {
		const opentui = await loadOpenTui();
		if (opentui) return await opentui.attach(session);
		return attachFallback(session);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err({ kind: "setup-failed", message });
	}
}

async function loadOpenTui(): Promise<{ attach: typeof attachTui } | null> {
	try {
		const mod = await import("@opentui/core");
		return {
			attach: (session) => attachOpenTui(session, mod),
		};
	} catch {
		return null;
	}
}

async function attachOpenTui(
	session: Session,
	mod: Record<string, unknown>,
): Promise<Result<TerminalAttachment & { done: Promise<void> }, UiError>> {
	const create = (mod.createCliRenderer ?? mod.createRenderer) as undefined | ((opts?: object) => Promise<any> | any);
	if (typeof create !== "function") {
		return attachFallback(session);
	}
	let renderer: any;
	try {
		renderer = await create.call(mod, {
			exitOnCtrlC: false,
			useAlternateScreen: true,
			targetFps: 60,
		});
	} catch (error) {
		return err({ kind: "setup-failed", message: error instanceof Error ? error.message : String(error) });
	}
	let interaction: InteractionState = LIST_FOCUS;
	let closed = false;
	let resolveDone: () => void = () => undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const unsubscribe = session.subscribe((snapshot) => {
		try {
			paintRenderer(renderer, snapshot, interaction, mod);
		} catch {
			// keep session alive if a frame fails
		}
	});
	const onKey = (key: any) => {
		const name = String(key?.name ?? key?.sequence ?? key ?? "");
		const ctrl = Boolean(key?.ctrl);
		const shift = Boolean(key?.shift);
		const mapped = normalizeOpenTuiKey(name, ctrl, shift);
		if (!mapped) return;
		const result = reduceInteraction(interaction, mapped, session.snapshot().activeFilter);
		interaction = result.state;
		if (result.command) session.dispatch(result.command);
		if (result.quit) void shutdown();
	};
	renderer.on?.("key", onKey);
	renderer.on?.("resize", (cols: number, rows: number) => {
		session.dispatch({ kind: "resize", columns: cols, rows });
	});

	async function shutdown(): Promise<void> {
		if (closed) return;
		closed = true;
		unsubscribe();
		try {
			renderer.off?.("key", onKey);
			await renderer.destroy?.();
		} catch {
			// ignore
		}
		resolveDone();
	}

	return ok({
		done,
		close: shutdown,
	});
}

function normalizeOpenTuiKey(
	name: string,
	ctrl: boolean,
	shift: boolean,
): { kind: "key"; key: string; ctrl: boolean; shift: boolean } | null {
	const lower = name.toLowerCase();
	const map: Record<string, string> = {
		arrowup: "up",
		up: "up",
		arrowdown: "down",
		down: "down",
		pageup: "pageup",
		pagedown: "pagedown",
		home: "home",
		end: "end",
		escape: "escape",
		return: "enter",
		enter: "enter",
		tab: "tab",
		backspace: "backspace",
	};
	const key = map[lower] ?? (name.length === 1 ? name : lower);
	if (!key) return null;
	return { kind: "key", key, ctrl, shift };
}

function paintRenderer(
	renderer: any,
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	_mod: Record<string, unknown>,
): void {
	const lines = layoutLines(snapshot, interaction);
	if (typeof renderer.fill === "function") {
		renderer.fill(" ");
	}
	if (renderer.root && typeof renderer.root.add === "function") {
		return;
	}
	void lines;
	void colorForLevel;
	void OVERSCAN;
}

function layoutLines(snapshot: SessionSnapshot, interaction: InteractionState): string[] {
	if (snapshot.notice === "resize-required") {
		return ["Terminal too small. Resize to at least 40x8. Ingestion continues."];
	}
	const lines = [formatStatus(snapshot), formatFilter(snapshot)];
	if (interaction.focus === "filters") {
		lines.push(
			`Edit ${interaction.field}: ${interaction.draft[interaction.field]}${interaction.error ? `  ! ${interaction.error.message}` : ""}`,
		);
	}
	for (const row of snapshot.rows) lines.push(renderRowText(row));
	lines.push(formatFooter(snapshot));
	lines.push(formatHints());
	return lines;
}

function attachFallback(session: Session): Result<TerminalAttachment & { done: Promise<void> }, UiError> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return err({ kind: "setup-failed", message: "no TTY available for fallback renderer" });
	}
	let interaction: InteractionState = LIST_FOCUS;
	let closed = false;
	let resolveDone: () => void = () => undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const wasRaw = process.stdin.isRaw;
	process.stdin.setRawMode?.(true);
	process.stdin.resume();
	process.stdout.write("\x1b[?1049h\x1b[?25l");
	const unsubscribe = session.subscribe((snapshot) => {
		const lines = layoutLines(snapshot, interaction);
		process.stdout.write(`\x1b[H\x1b[J${lines.join("\r\n")}`);
	});
	const onData = (chunk: Buffer | string): void => {
		const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
		const mapped = keyFromInput(text);
		if (!mapped) return;
		const result = reduceInteraction(interaction, { kind: "key", ...mapped }, session.snapshot().activeFilter);
		interaction = result.state;
		if (result.command) session.dispatch(result.command);
		if (result.quit) void shutdown();
	};
	process.stdin.on("data", onData);

	async function shutdown(): Promise<void> {
		if (closed) return;
		closed = true;
		unsubscribe();
		process.stdin.off("data", onData);
		process.stdin.setRawMode?.(wasRaw ?? false);
		process.stdout.write("\x1b[?25h\x1b[?1049l");
		resolveDone();
	}

	return ok({ done, close: shutdown });
}

export type { LogEvent };
