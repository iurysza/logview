import {
	createSession,
	defaultSessionOptions,
	type Session,
	type SessionSnapshot,
} from "@logview/engine";
import type { LogLevel } from "@logview/core";
import { ManualScheduler } from "./manual-scheduler.ts";
import { ScriptedSource } from "./scripted-source.ts";
import { threadtimeLine } from "./log-lines.ts";

export type Scenario = {
	session: Session;
	source: ScriptedSource;
	scheduler: ManualScheduler;
	deliver(ids: readonly number[], extra?: (id: number) => { message?: string; level?: LogLevel }): Promise<void>;
	finish(): Promise<void>;
	waitUntil(predicate: (snapshot: SessionSnapshot) => boolean): Promise<SessionSnapshot>;
};

export async function openScenario(options?: {
	maxEvents?: number;
	rows?: number;
	columns?: number;
	sessionId?: string;
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
		{ source, scheduler },
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
