import { describe, expect, test } from "bun:test";
import { clipToWidth, displayWidth, padToWidth, sanitizeDisplay } from "@logview/core";

describe("display text", () => {
	test("measures Japanese as wide cells", () => {
		expect(displayWidth("日本語")).toBe(6);
		expect(displayWidth("日本語 ok")).toBe(9);
	});

	test("expands tabs to tab stops and escapes ESC", () => {
		expect(sanitizeDisplay("\tfoo")).toBe("    foo");
		expect(sanitizeDisplay("ab\t")).toBe("ab  ");
		expect(sanitizeDisplay("stray \u001b[31m")).toBe("stray ^[[31m");
		expect(displayWidth(sanitizeDisplay("\u001b[31m"))).toBe(6);
	});

	test("clips to cell width with an ellipsis and pads", () => {
		const clipped = clipToWidth("日本語message", 5);
		expect(clipped.clipped).toBe(true);
		expect(clipped.width).toBeLessThanOrEqual(5);
		expect(displayWidth(clipped.text)).toBe(clipped.width);
		expect(padToWidth("ok", 4)).toBe("ok  ");
		expect(displayWidth(padToWidth("日本語", 8))).toBe(8);
	});

	test("combining marks do not add width", () => {
		expect(displayWidth("e\u0301")).toBe(1);
	});
});
