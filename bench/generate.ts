const seed = 20260918;

function mulberry32(start: number): () => number {
	let t = start >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

export function generateLines(count: number, startSeed = seed): string[] {
	const random = mulberry32(startSeed);
	const lines: string[] = [];

	for (let i = 0; i < count; i += 1) {
		const size = random() < 0.95 ? 256 : 1024;
		const payload = "x".repeat(Math.max(8, Math.floor(size / 8)));
		const micros = String(i).padStart(6, "0");
		lines.push(`1760000000.${micros}  1234  1250 I Bench: ${payload}`);
	}

	return lines;
}

if (import.meta.main) {
	const count = Number(process.argv[2] ?? "1000");
	process.stdout.write(`${generateLines(count).join("\n")}\n`);
}
