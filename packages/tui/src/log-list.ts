import type { ViewRow } from "@logview/core";
import { renderRowText } from "./app.ts";

export const ROW_POOL_OVERSCAN = 2;

export function visiblePoolSize(visibleRows: number): number {
	return Math.max(0, visibleRows) + ROW_POOL_OVERSCAN;
}

export function paintLogList(rows: readonly ViewRow[]): string[] {
	return rows.map(renderRowText);
}
