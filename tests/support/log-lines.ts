import type { LogLevel } from "@logcayo/core";

export function threadtimeLine(
	id: number,
	options?: { level?: LogLevel; tag?: string; message?: string; pid?: number; uid?: number },
): string {
	const epoch = 1_760_000_000;
	const micros = String(id).padStart(6, "0");
	const uid = options?.uid === undefined ? "" : `${String(options.uid).padStart(6, " ")} `;
	const pid = String(options?.pid ?? 1234).padStart(5, " ");
	const tid = " 1250";
	const level = options?.level ?? "I";
	const tag = options?.tag ?? "App";
	const message = options?.message ?? `event-${id}`;

	return `${epoch}.${micros}${uid}${pid}${tid} ${level} ${tag}: ${message}`;
}
