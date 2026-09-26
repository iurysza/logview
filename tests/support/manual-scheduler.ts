import type { Cancel, Scheduler } from "@logcayo/engine";

export class ManualScheduler implements Scheduler {
	now = 0;
	private readonly tasks: Array<{ at: number; run: () => void; cancelled: boolean }> = [];

	nowMs(): number {
		return this.now;
	}

	after(delayMs: number, task: () => void): Cancel {
		const item = { at: this.now + delayMs, run: task, cancelled: false };
		this.tasks.push(item);

		return () => {
			item.cancelled = true;
		};
	}

	async yield(): Promise<void> {
		await Promise.resolve();
		await this.flush();
	}

	async runUntilIdle(): Promise<void> {
		for (let i = 0; i < 4_000; i += 1) {
			await this.flush();
			await Promise.resolve();
		}
	}

	async flush(): Promise<void> {
		for (let guard = 0; guard < 10_000; guard += 1) {
			const due: Array<() => void> = [];

			for (const task of this.tasks) {
				if (!task.cancelled && task.at <= this.now) due.push(task.run);
			}

			this.tasks.splice(
				0,
				this.tasks.length,
				...this.tasks.filter((task) => task.cancelled || task.at > this.now),
			);

			if (due.length === 0) return;

			for (const run of due) run();
			await Promise.resolve();
		}
	}
}
