import { fgItalic, fgOn, fgOnly, MOCHA, paintStyled, styleOn, type CellStyle } from "./catppuccin.ts";
import type { Rgb } from "./catppuccin.ts";

export type HighlightKind =
	| "uuid"
	| "url"
	| "ipv4"
	| "http"
	| "keyword"
	| "date"
	| "time"
	| "path"
	| "pointer"
	| "process"
	| "quote"
	| "duration"
	| "number"
	| "kv";

type Token = Readonly<{
	kind: HighlightKind;
	start: number;
	end: number;
	text: string;
}>;

function priority(kind: HighlightKind): number {
	if (kind === "uuid") return 100;

	if (kind === "url") return 90;

	if (kind === "ipv4") return 85;

	if (kind === "http") return 80;

	if (kind === "keyword") return 75;

	if (kind === "date") return 70;

	if (kind === "time") return 65;

	if (kind === "path") return 60;

	if (kind === "pointer") return 55;

	if (kind === "process") return 50;

	if (kind === "quote") return 40;

	if (kind === "duration") return 35;

	if (kind === "number") return 20;

	return 10;
}

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

const URL_RE = /https?:\/\/[^\s"'<>]+/g;

const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

const HTTP_RE = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

const KEYWORD_RE = /\b(?:ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|true|false|null)\b/g;

const DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:T|\b)/g;

const TIME_RE = /\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?\b/g;

const PATH_RE = /(?:~|\/)(?:[\w.-]+\/)+[\w.-]*/g;

const POINTER_RE = /\b0x[0-9a-fA-F]+\b/g;

const PROCESS_RE = /\b[A-Za-z][\w.-]*\[\d+\]/g;

const QUOTE_RE = /"(?:\\.|[^"\\])*"/g;

const DURATION_RE = /\b\d+(?:\.\d+)?(?:ms|s|sec|seconds|m|min)\b/g;

const NUMBER_RE = /\b\d+(?:\.\d+)?%?\b/g;

const KV_RE = /\b[A-Za-z_][\w.-]*=/g;

let activeBg: Rgb | null = null;

function paint(text: string, style: CellStyle): string {
	return paintStyled(text, styleOn(style, activeBg));
}

function collect(pattern: RegExp, kind: HighlightKind, text: string, into: Token[]): void {
	pattern.lastIndex = 0;
	let match = pattern.exec(text);

	while (match) {
		const value = match[0];
		into.push({
			kind,
			start: match.index,
			end: match.index + value.length,
			text: value,
		});
		match = pattern.exec(text);
	}
}

function pickTokens(text: string): Token[] {
	const found: Token[] = [];
	collect(UUID_RE, "uuid", text, found);
	collect(URL_RE, "url", text, found);
	collect(IPV4_RE, "ipv4", text, found);
	collect(HTTP_RE, "http", text, found);
	collect(KEYWORD_RE, "keyword", text, found);
	collect(DATE_RE, "date", text, found);
	collect(TIME_RE, "time", text, found);
	collect(PATH_RE, "path", text, found);
	collect(POINTER_RE, "pointer", text, found);
	collect(PROCESS_RE, "process", text, found);
	collect(QUOTE_RE, "quote", text, found);
	collect(DURATION_RE, "duration", text, found);
	collect(NUMBER_RE, "number", text, found);
	collect(KV_RE, "kv", text, found);

	found.sort((left, right) => {
		if (left.start !== right.start) return left.start - right.start;

		const rank = priority(right.kind) - priority(left.kind);

		if (rank !== 0) return rank;

		return right.end - right.start - (left.end - left.start);
	});

	const chosen: Token[] = [];
	let cursor = 0;

	for (const token of found) {
		if (token.start < cursor) continue;

		chosen.push(token);
		cursor = token.end;
	}

	return chosen;
}

function paintUuid(text: string): string {
	let out = "";

	for (const char of text) {
		if (char === "-") out += paint(char, fgOnly(MOCHA.red));
		else if (char >= "0" && char <= "9") out += paint(char, fgItalic(MOCHA.blue));
		else out += paint(char, fgItalic(MOCHA.mauve));
	}

	return out;
}

function paintIpv4(text: string): string {
	let out = "";

	for (const char of text) {
		if (char === ".") out += paint(char, fgOnly(MOCHA.red));
		else out += paint(char, fgItalic(MOCHA.blue));
	}

	return out;
}

function paintPath(text: string): string {
	let out = "";

	for (const char of text) {
		if (char === "/") out += paint(char, fgOnly(MOCHA.yellow));
		else out += paint(char, fgOnly(MOCHA.green));
	}

	return out;
}

function paintPointer(text: string): string {
	if (!text.startsWith("0x")) return paint(text, fgItalic(MOCHA.blue));

	let out = paint("0", fgItalic(MOCHA.blue)) + paint("x", fgOnly(MOCHA.red));

	for (const char of text.slice(2)) {
		if (char >= "0" && char <= "9") out += paint(char, fgItalic(MOCHA.blue));
		else out += paint(char, fgItalic(MOCHA.mauve));
	}

	return out;
}

function paintUrl(text: string): string {
	const schemeEnd = text.indexOf("://");

	if (schemeEnd < 0) return paint(text, fgOnly(MOCHA.blue));

	const scheme = text.slice(0, schemeEnd);
	const rest = text.slice(schemeEnd + 3);
	const pathStart = rest.search(/[/?#]/);
	const host = pathStart < 0 ? rest : rest.slice(0, pathStart);
	const after = pathStart < 0 ? "" : rest.slice(pathStart);
	const queryStart = after.indexOf("?");
	const path = queryStart < 0 ? after : after.slice(0, queryStart);
	const query = queryStart < 0 ? "" : after.slice(queryStart);
	const schemeStyle = scheme === "https" ? fgOnly(MOCHA.green) : fgOnly(MOCHA.red);
	let out = paint(scheme, schemeStyle);
	out += paint("://", fgOnly(MOCHA.red));
	out += paint(host, fgOnly(MOCHA.blue));
	out += paintPath(path);

	if (query.length === 0) return out;

	out += paint("?", fgOnly(MOCHA.red));
	const body = query.slice(1);
	const parts = body.split("&");

	for (let i = 0; i < parts.length; i += 1) {
		if (i > 0) out += paint("&", fgOnly(MOCHA.red));

		const pair = parts[i] ?? "";
		const eq = pair.indexOf("=");

		if (eq < 0) {
			out += paint(pair, fgOnly(MOCHA.mauve));
			continue;
		}

		out += paint(pair.slice(0, eq), fgOnly(MOCHA.mauve));
		out += paint("=", fgOnly(MOCHA.red));
		out += paint(pair.slice(eq + 1), fgOnly(MOCHA.teal));
	}

	return out;
}

function keywordStyle(word: string): CellStyle {
	if (word === "ERROR" || word === "FATAL") return fgOnly(MOCHA.red);

	if (word === "WARN" || word === "WARNING") return fgOnly(MOCHA.yellow);

	if (word === "INFO") return fgOnly(MOCHA.teal);

	if (word === "DEBUG") return fgOnly(MOCHA.green);

	if (word === "TRACE") return fgOnly(MOCHA.overlay2);

	if (word === "true" || word === "false" || word === "null") return fgItalic(MOCHA.maroon);

	return fgOnly(MOCHA.text);
}

function httpStyle(method: string): CellStyle {
	if (method === "GET" || method === "HEAD") return fgOn(MOCHA.crust, MOCHA.green);

	if (method === "POST") return fgOn(MOCHA.crust, MOCHA.yellow);

	if (method === "DELETE") return fgOn(MOCHA.crust, MOCHA.red);

	return fgOn(MOCHA.crust, MOCHA.mauve);
}

function paintDate(text: string): string {
	let out = "";

	for (const char of text) {
		if (char === "-" || char === "T") out += paint(char, fgOnly(MOCHA.overlay0));
		else out += paint(char, fgOnly(MOCHA.mauve));
	}

	return out;
}

function paintTime(text: string): string {
	let out = "";

	for (const char of text) {
		if (char === "Z") out += paint(char, fgOnly(MOCHA.red));
		else if (char === ":" || char === "." || char === ",") out += paint(char, fgOnly(MOCHA.overlay0));
		else out += paint(char, fgOnly(MOCHA.blue));
	}

	return out;
}

function paintDuration(text: string): string {
	const unit = text.match(/(ms|seconds|sec|min|s|m)$/);

	if (!unit || unit.index === undefined) return paint(text, fgOnly(MOCHA.blue));

	return paint(text.slice(0, unit.index), fgOnly(MOCHA.blue)) + paint(unit[0], fgItalic(MOCHA.mauve));
}

function paintProcess(text: string): string {
	const open = text.lastIndexOf("[");

	if (open < 0) return paint(text, fgOnly(MOCHA.yellow));

	return (
		paint(text.slice(0, open), fgOnly(MOCHA.yellow)) +
		paint("[", fgOnly(MOCHA.red)) +
		paint(text.slice(open + 1, -1), fgOnly(MOCHA.teal)) +
		paint("]", fgOnly(MOCHA.red))
	);
}

function paintQuote(text: string): string {
	if (text.length < 2) return paint(text, fgOnly(MOCHA.yellow));

	return (
		paint(text[0]!, fgOnly(MOCHA.yellow)) +
		highlightLogText(text.slice(1, -1)) +
		paint(text[text.length - 1]!, fgOnly(MOCHA.yellow))
	);
}

function paintToken(token: Token): string {
	if (token.kind === "uuid") return paintUuid(token.text);

	if (token.kind === "ipv4") return paintIpv4(token.text);

	if (token.kind === "url") return paintUrl(token.text);

	if (token.kind === "path") return paintPath(token.text);

	if (token.kind === "pointer") return paintPointer(token.text);

	if (token.kind === "http") return paint(token.text, httpStyle(token.text));

	if (token.kind === "keyword") return paint(token.text, keywordStyle(token.text));

	if (token.kind === "date") return paintDate(token.text);

	if (token.kind === "time") return paintTime(token.text);

	if (token.kind === "duration") return paintDuration(token.text);

	if (token.kind === "process") return paintProcess(token.text);

	if (token.kind === "quote") return paintQuote(token.text);

	if (token.kind === "number") return paint(token.text, fgOnly(MOCHA.teal));

	return paint(token.text.slice(0, -1), fgOnly(MOCHA.overlay2)) + paint("=", fgOnly(MOCHA.text));
}

export function highlightLogText(text: string, bg: Rgb | null = null): string {
	const previous = activeBg;
	activeBg = bg;
	const tokens = pickTokens(text);
	let out = "";
	let cursor = 0;

	for (const token of tokens) {
		if (token.start > cursor) out += paint(text.slice(cursor, token.start), fgOnly(MOCHA.text));
		out += paintToken(token);
		cursor = token.end;
	}

	if (cursor < text.length) out += paint(text.slice(cursor), fgOnly(MOCHA.text));

	activeBg = previous;

	return out;
}
