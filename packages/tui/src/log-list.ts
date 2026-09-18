import type { ViewRow } from "@logview/core";
import { renderRowText } from "./app.ts";
import type { PaintStyle } from "./color.ts";

export const ROW_POOL_OVERSCAN = 2;

export function visiblePoolSize(visibleRows: number): number {
	return Math.max(0, visibleRows) + ROW_POOL_OVERSCAN;
}

export function paintLogList(rows: readonly ViewRow[], style: PaintStyle = "plain"): string[] {
	const painted: string[] = [];

	for (const row of rows) painted.push(renderRowText(row, style));

	return painted;
}
