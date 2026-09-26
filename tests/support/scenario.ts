import {
	createSession,
	defaultSessionOptions,
	type LogClassifier,
	type PackageResolver,
	type SemanticOptions,
	type Session,
	type SessionSnapshot,
} from "@logcayo/engine";
import { ManualScheduler } from "./manual-scheduler.ts";
import { ScriptedSource } from "./scripted-source.ts";
import { threadtimeLine } from "./log-lines.ts";

type LogLineOptions = NonNullable<Parameters<typeof threadtimeLine>[1]>;

export type Scenario = {
	session: Session;
	source: ScriptedSource;
	scheduler: ManualScheduler;
	deliver(ids: readonly number[], extra?: (id: number) => LogLineOptions): Promise<void>;
	finish(): Promise<void>;
	waitUntil(predicate: (snapshot: SessionSnapshot) => boolean): Promise<SessionSnapshot>;
};

export async function openScenario(options?: {
	maxEvents?: number;
	rows?: number;
	columns?: number;
	sessionId?: string;
	classifier?: LogClassifier;
	semantic?: Partial<SemanticOptions>;
	packageResolver?: PackageResolver;
}): Promise<Scenario> {
	const source = new ScriptedSource();
	const scheduler = new ManualScheduler();

	const created = createSession(
		defaultSessionOptions({
			sessionId: options?.sessionId ?? "scenario",
			maxEvents: options?.maxEvents ?? 8,
			rows: options?.rows ?? 8,
			columns: options?.columns ?? 80,
		}),
		{
			source,
			scheduler,
			classifier: options?.classifier,
			semantic: options?.semantic,
			packageResolver: options?.packageResolver,
		},
	);

	if (!created.ok) throw new Error(created.error.message);

	const session = created.value;
	const started = session.start();

	if (!started.ok) throw new Error(started.error.kind);
	await tick(scheduler);

	return {
		session,
		source,
		scheduler,
		async deliver(ids, extra) {
			for (const id of ids) {
				source.pushLine(threadtimeLine(id, extra?.(id)), id);
			}

			await tick(scheduler);
		},
		async finish() {
			source.end();
			await tick(scheduler);
			await session.sourceDone;
			await tick(scheduler);
		},
		async waitUntil(predicate) {
			for (let i = 0; i < 5_000; i += 1) {
				const snapshot = session.snapshot();

				if (predicate(snapshot)) return snapshot;
				await tick(scheduler);
			}

			throw new Error("scenario timed out");
		},
	};
}

export async function tick(scheduler: ManualScheduler): Promise<void> {
	for (let i = 0; i < 32; i += 1) {
		await scheduler.flush();
		await Promise.resolve();
	}
}
