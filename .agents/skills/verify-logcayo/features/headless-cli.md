# Headless CLI

Headless mode prints one JSON summary after the source ends and never opens the TUI. Live capture against a stub uses the same summary.

## Sub-features

- `headless-replay` replays the sanitized fixture and prints a success summary.
- `headless-live-stub` captures the one-device stub to the same admitted-event count.
- `headless-no-device` explains that no device is available and exits `1`.
- `headless-ambiguous` refuses to pick among several devices and exits `1`.

## How to get to it (user POV)

- Run `logcayo replay PATH --speed instant --headless`.
- Run `logcayo live --headless --serial DEVICE` with `--adb` pointed at a stub.
- Run `logcayo live --headless` with the no-device or multi-device stub.

## Driving it with logcayo

Preconditions:

- `bun .agents/skills/verify-logcayo/doctor.ts` reports `ok`.
- Work from the repository root.
- Do not set `TYPESAFE_API_KEY` unless you are proving Jev.

- **Replay summary.** Run `bun run logcayo replay tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl --speed instant --headless`. Exit code `0`. The last stdout line is JSON with `version` `1`, `kind` `"summary"`, `terminal.kind` `"ended"`, and `snapshot.stats.admittedEvents` `15`.
- **Live stub.** Run `bun run logcayo live --headless --adb tests/support/adb-stubs/one-device --serial emulator-5554`. Exit code `0`. The summary `terminal.kind` is `"ended"` and `admittedEvents` is `15`.
- **No device.** Run `bun run logcayo live --headless --adb tests/support/adb-stubs/no-device`. Exit code `1`. Stderr or stdout names the missing-device failure.
- **Several devices.** Run `bun run logcayo live --headless --adb tests/support/adb-stubs/multi-device`. Exit code `1`. The output contains `ambiguous-device`.
- **Proof.** Save the command, exit code, stderr, and the JSON line under `generated/ui/headless/<entry>/`. The JSON must be the process output, not a value constructed from `Session.snapshot()` in a test.

## Gotchas

- Interactive live and replay attach the TUI only when stdout is a TTY. `--headless` is the path that always prints JSON.
- `--adb` must be the stub script path, such as `tests/support/adb-stubs/one-device`. Do not put a real `adb` on `PATH` for this feature.
- Several devices without `--serial` is a refusal, not a picker. Do not pass `--serial` when proving `headless-ambiguous`.
- Recording is a separate command (`logcayo record --out PATH`). It is not this feature. Do not write recordings into `tests/fixtures/`.
- Jev needs `TYPESAFE_API_KEY` and `--semantic` or `semantic.enabled`. Headless tests in `bun run check` never call Jev. Skip semantic proof unless that is the feature under test.
