import type { Cancel, Scheduler } from "../ports.ts";

export class RealScheduler implements Scheduler {
	nowMs(): number {
		return performance.now();
	}

	after(delayMs: number, task: () => void): Cancel {
		const handle = setTimeout(task, Math.max(0, delayMs));

		return () => {
			clearTimeout(handle);
		};
	}

	yield(): Promise<void> {
		return new Promise((resolve) => {
			queueMicrotask(resolve);
		});
	}
}

export function createScheduler(): Scheduler {
	return new RealScheduler();
}
