import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@logview/core";
import {
	DEFAULT_JEV_TIMEOUT_MS,
	defaultSemanticOptions,
	JEV_MODEL_ID,
	type SemanticOptions,
} from "@logview/engine";
import { Either, Schema } from "effect";

export type ConfigError = Readonly<{
	exit: 2;
	message: string;
}>;

export const DEFAULT_CONFIG_FILENAME = "logview.json";

const UnitInterval = Schema.Number.pipe(Schema.finite(), Schema.between(0, 1));

const NaturalInt = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0));

const DelayMs = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0));

const SemanticFileSchema = Schema.Struct({
	enabled: Schema.optional(Schema.Boolean),
	threshold: Schema.optional(UnitInterval),
	model: Schema.optional(Schema.NonEmptyString),
	flushMs: Schema.optional(DelayMs),
	batchItems: Schema.optional(NaturalInt),
	historyEvents: Schema.optional(NaturalInt),
	maxInFlight: Schema.optional(NaturalInt),
	maxQueued: Schema.optional(NaturalInt),
	maxRequestBytes: Schema.optional(NaturalInt),
	timeoutMs: Schema.optional(NaturalInt),
});

const FilterFileSchema = Schema.Struct({
	text: Schema.optional(Schema.String),
});

const LogviewFileSchema = Schema.Struct({
	semantic: Schema.optional(SemanticFileSchema),
	filter: Schema.optional(FilterFileSchema),
});

const LogviewFileJsonSchema = Schema.parseJson(LogviewFileSchema);

export type LogviewFile = typeof LogviewFileSchema.Type;

export type CliOverlay = Readonly<{
	enabled: boolean | null;
	threshold: number | null;
	filterText: string | null;
	modelFromEnv: string | null;
}>;

export type ResolvedSemantic = Readonly<{
	enabled: boolean;
	threshold: number;
	modelId: string;
	timeoutMs: number;
	maxBatchItems: number;
	historyEvents: number;
	flushDelayMs: number;
	maxInFlight: number;
	maxQueuedIds: number;
	maxRequestBytes: number;
}>;

export type ResolvedViewer = Readonly<{
	filterText: string;
	semantic: ResolvedSemantic;
}>;

function configParseMessage(message: string): string {
	if (
		message.includes("apiKey") ||
		message.includes("api_key") ||
		message.includes("TYPESAFE_API_KEY")
	) {
		return "config must not contain an API key; set TYPESAFE_API_KEY in the environment";
	}

	if (message.includes("JSON Parse error")) {
		return "config is not valid JSON";
	}

	if (message.includes("is unexpected")) {
		const key = message.match(/\["([^"]+)"\]/);

		return key ? `invalid config: unknown key ${key[1]}` : "invalid config: unknown key";
	}

	const expected = message.match(/Expected [^\n]+, actual [^\n]+/);

	if (expected) return `invalid config: ${expected[0]}`;

	return "invalid config";
}

export function decodeConfigJson(text: string): Result<LogviewFile, ConfigError> {
	const decoded = Schema.decodeEither(LogviewFileJsonSchema, { onExcessProperty: "error" })(text);

	return Either.match(decoded, {
		onLeft: (error) => err({ exit: 2, message: configParseMessage(error.message) }),
		onRight: ok,
	});
}

function isMissingFile(cause: unknown): boolean {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export async function readConfigFile(
	explicitPath: string | null,
	cwd = process.cwd(),
): Promise<Result<LogviewFile | null, ConfigError>> {
	const path = explicitPath ?? join(cwd, DEFAULT_CONFIG_FILENAME);
	const required = explicitPath !== null;

	try {
		const text = await readFile(path, "utf8");
		const decoded = decodeConfigJson(text);

		if (!decoded.ok) {
			return err({ exit: 2, message: `${path}: ${decoded.error.message}` });
		}

		return decoded;
	} catch (cause) {

		if (!required && isMissingFile(cause)) return ok(null);

		return err({ exit: 2, message: `cannot read config ${path}` });
	}
}

export function resolveViewerSettings(
	file: LogviewFile | null,
	overlay: CliOverlay,
): ResolvedViewer {
	const defaults = defaultSemanticOptions();
	const semanticFile = file?.semantic;
	const filterFile = file?.filter;

	return {
		filterText: overlay.filterText ?? filterFile?.text ?? "",
		semantic: {
			enabled: overlay.enabled ?? semanticFile?.enabled ?? false,
			threshold: overlay.threshold ?? semanticFile?.threshold ?? defaults.threshold,
			modelId: overlay.modelFromEnv ?? semanticFile?.model ?? JEV_MODEL_ID,
			timeoutMs: semanticFile?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
			maxBatchItems: semanticFile?.batchItems ?? defaults.maxBatchItems,
			historyEvents: semanticFile?.historyEvents ?? defaults.historyEvents,
			flushDelayMs: semanticFile?.flushMs ?? defaults.flushDelayMs,
			maxInFlight: semanticFile?.maxInFlight ?? defaults.maxInFlight,
			maxQueuedIds: semanticFile?.maxQueued ?? defaults.maxQueuedIds,
			maxRequestBytes: semanticFile?.maxRequestBytes ?? defaults.maxRequestBytes,
		},
	};
}

export function semanticSessionOptions(semantic: ResolvedSemantic): Partial<SemanticOptions> {
	return {
		threshold: semantic.threshold,
		modelId: semantic.modelId,
		maxBatchItems: semantic.maxBatchItems,
		historyEvents: semantic.historyEvents,
		flushDelayMs: semantic.flushDelayMs,
		maxInFlight: semantic.maxInFlight,
		maxQueuedIds: semantic.maxQueuedIds,
		maxRequestBytes: semantic.maxRequestBytes,
	};
}
