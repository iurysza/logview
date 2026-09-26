import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_JEV_TIMEOUT_MS,
	DEFAULT_SEMANTIC_BATCH_ITEMS,
	DEFAULT_SEMANTIC_FLUSH_MS,
	DEFAULT_SEMANTIC_HISTORY_EVENTS,
	DEFAULT_SEMANTIC_THRESHOLD,
	JEV_MODEL_ID,
} from "@logcayo/engine";
import {
	decodeConfigJson,
	readConfigFile,
	resolveViewerSettings,
	type CliOverlay,
} from "../src/config.ts";

const emptyOverlay: CliOverlay = {
	enabled: null,
	threshold: null,
	filterText: null,
	modelFromEnv: null,
};

describe("logcayo.json", () => {
	test("empty object keeps semantic off and engine defaults", () => {
		const decoded = decodeConfigJson("{}");

		expect(decoded.ok).toBe(true);

		if (!decoded.ok) return;

		const resolved = resolveViewerSettings(decoded.value, emptyOverlay);

		expect(resolved.filterText).toBe("");
		expect(resolved.semantic.enabled).toBe(false);
		expect(resolved.semantic.threshold).toBe(DEFAULT_SEMANTIC_THRESHOLD);
		expect(resolved.semantic.modelId).toBe(JEV_MODEL_ID);
		expect(resolved.semantic.timeoutMs).toBe(DEFAULT_JEV_TIMEOUT_MS);
		expect(resolved.semantic.maxBatchItems).toBe(DEFAULT_SEMANTIC_BATCH_ITEMS);
		expect(resolved.semantic.historyEvents).toBe(DEFAULT_SEMANTIC_HISTORY_EVENTS);
		expect(resolved.semantic.flushDelayMs).toBe(DEFAULT_SEMANTIC_FLUSH_MS);
	});

	test("file values fill the viewer settings", () => {
		const decoded = decodeConfigJson(
			JSON.stringify({
				filter: { text: "database locks" },
				semantic: {
					enabled: true,
					threshold: 0.8,
					model: "jev-test",
					flushMs: 0,
					batchItems: 10,
					historyEvents: 25,
					maxInFlight: 1,
					maxQueued: 50,
					maxRequestBytes: 4096,
					timeoutMs: 1000,
				},
			}),
		);

		expect(decoded.ok).toBe(true);

		if (!decoded.ok) return;

		const resolved = resolveViewerSettings(decoded.value, emptyOverlay);

		expect(resolved.filterText).toBe("database locks");
		expect(resolved.semantic.enabled).toBe(true);
		expect(resolved.semantic.threshold).toBe(0.8);
		expect(resolved.semantic.modelId).toBe("jev-test");
		expect(resolved.semantic.flushDelayMs).toBe(0);
		expect(resolved.semantic.maxBatchItems).toBe(10);
		expect(resolved.semantic.historyEvents).toBe(25);
		expect(resolved.semantic.maxInFlight).toBe(1);
		expect(resolved.semantic.maxQueuedIds).toBe(50);
		expect(resolved.semantic.maxRequestBytes).toBe(4096);
		expect(resolved.semantic.timeoutMs).toBe(1000);
	});

	test("CLI overlay overrides the file", () => {
		const decoded = decodeConfigJson(
			JSON.stringify({
				filter: { text: "from-file" },
				semantic: { enabled: true, threshold: 0.2, model: "file-model" },
			}),
		);

		expect(decoded.ok).toBe(true);

		if (!decoded.ok) return;

		const resolved = resolveViewerSettings(decoded.value, {
			enabled: false,
			threshold: 0.9,
			filterText: "from-flag",
			modelFromEnv: "env-model",
		});

		expect(resolved.filterText).toBe("from-flag");
		expect(resolved.semantic.enabled).toBe(false);
		expect(resolved.semantic.threshold).toBe(0.9);
		expect(resolved.semantic.modelId).toBe("env-model");
	});

	test("rejects an API key field", () => {
		const decoded = decodeConfigJson(JSON.stringify({ semantic: { apiKey: "secret" } }));

		expect(decoded.ok).toBe(false);

		if (decoded.ok) return;

		expect(decoded.error.message).toContain("API key");
		expect(decoded.error.message.includes("secret")).toBe(false);
	});

	test("rejects a threshold outside 0..1", () => {
		const decoded = decodeConfigJson(JSON.stringify({ semantic: { threshold: 1.2 } }));

		expect(decoded.ok).toBe(false);

		if (decoded.ok) return;

		expect(decoded.error.message).toBe("invalid config: Expected a number between 0 and 1, actual 1.2");
	});

	test("rejects unknown keys", () => {
		const decoded = decodeConfigJson(JSON.stringify({ extra: true }));

		expect(decoded.ok).toBe(false);

		if (decoded.ok) return;

		expect(decoded.error.message).toBe("invalid config: unknown key extra");
	});

	test("rejects invalid JSON", () => {
		const decoded = decodeConfigJson("{ not json");

		expect(decoded.ok).toBe(false);

		if (decoded.ok) return;

		expect(decoded.error.message).toBe("config is not valid JSON");
	});

	test("readConfigFile loads an explicit path and skips a missing default", async () => {
		const dir = await mkdtemp(join(tmpdir(), "logcayo-config-"));
		const path = join(dir, "settings.json");

		await writeFile(
			path,
			JSON.stringify({ semantic: { enabled: true, threshold: 0.4 } }),
		);

		const loaded = await readConfigFile(path);

		expect(loaded.ok).toBe(true);

		if (!loaded.ok) return;

		expect(loaded.value?.semantic?.enabled).toBe(true);
		expect(loaded.value?.semantic?.threshold).toBe(0.4);

		const missingRequired = await readConfigFile(join(dir, "missing.json"));

		expect(missingRequired.ok).toBe(false);

		const missingDefault = await readConfigFile(null, dir);

		expect(missingDefault.ok).toBe(true);

		if (!missingDefault.ok) return;

		expect(missingDefault.value).toBeNull();

		await writeFile(
			join(dir, "logcayo.json"),
			JSON.stringify({ filter: { text: "from-default" } }),
		);

		const defaultFile = await readConfigFile(null, dir);

		expect(defaultFile.ok).toBe(true);

		if (!defaultFile.ok) return;

		expect(defaultFile.value?.filter?.text).toBe("from-default");
	});
});
