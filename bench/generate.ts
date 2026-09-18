export const BENCH_SEED = 20260918;

export type LineSizePlan = Readonly<{
	medianBytes: number;
	p95Bytes: number;
	p95Share: number;
}>;

export const PRD_SIZE_PLAN: LineSizePlan = {
	medianBytes: 256,
	p95Bytes: 1024,
	p95Share: 0.05,
};

function mulberry32(start: number): () => number {
	let t = start >>> 0;

	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);

		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

export function generateLines(
	count: number,
	startSeed = BENCH_SEED,
	plan: LineSizePlan = PRD_SIZE_PLAN,
): string[] {
	const random = mulberry32(startSeed);
	const lines: string[] = [];

	for (let i = 0; i < count; i += 1) {
		const target = random() < 1 - plan.p95Share ? plan.medianBytes : plan.p95Bytes;
		const keep = i % 10 === 0;
		lines.push(lineFor(i, target, keep));
	}

	return lines;
}

function lineFor(index: number, targetBytes: number, keep: boolean): string {
	const seconds = 1_760_000_000 + Math.floor(index / 1_000_000);
	const micros = String(index % 1_000_000).padStart(6, "0");
	const prefix = `${seconds}.${micros}  1234  1250 I Bench: `;
	const marker = keep ? "KEEP " : "skip ";
	const bodyBudget = Math.max(8, targetBytes - prefix.length - marker.length - 1);

	return `${prefix}${marker}${"x".repeat(bodyBudget)}`;
}

if (import.meta.main) {
	const count = Number(process.argv[2] ?? "1000");
	process.stdout.write(`${generateLines(count).join("\n")}\n`);
}
