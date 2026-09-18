const mode = process.argv.includes("--mode") ? "headless" : "headless";

console.log(
	JSON.stringify({
		ok: true,
		mode,
		message: "Benchmark harness is a stub until a reference workload is recorded.",
	}),
);
