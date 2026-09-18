# logview

Keyboard-driven Android log viewer. V1 is a headless engine with a thin terminal adapter: the same session parses live ADB bytes, recorded files, and scripted tests.

## Commands

```sh
bun run logview -- live --serial DEVICE
bun run logview -- record --serial DEVICE --out sessions/example.lvr.jsonl --duration 60
bun run logview -- replay sessions/example.lvr.jsonl
bun run logview -- replay sessions/example.lvr.jsonl --speed 4
bun run logview -- replay sessions/example.lvr.jsonl --speed instant --headless
```

`--headless` prints one JSON summary after the source ends. It never loads OpenTUI.

## Capture profile

```
adb -s <serial> logcat -b main -b system -b crash -v threadtime -v epoch -v usec *:V
```

One physical output line is one event. Recordings are versioned JSON Lines (`logview-recording` v1) of raw stdout/stderr packets, not parsed events.

## Development

```sh
bun run check          # anti-slop (oxlint) + typecheck + headless tests
bun run test:headless  # lint + core/engine/CLI/architecture/quality tests
bun run test:adapters  # recording + ADB contract tests
bun run test:tui       # terminal adapter tests (optional OpenTUI)
```

Headless tests use a scripted source and a manual scheduler. They do not start ADB, open a TTY, or sleep on wall-clock timers.

## Layout

- `packages/core` — pure framing, parsing, filters, navigation, projection
- `packages/engine` — Effect-backed session, stores, recording, ADB/replay adapters
- `packages/cli` — `live`, `record`, `replay`
- `packages/tui` — OpenTUI adapter (fallback renderer if the native package is missing)
- `tests/support` — scripted source, manual scheduler, scenario harness
- `tests/fixtures/synthetic` — small packet and recording fixtures
- `tools/oxlint/anti-slop` — vendored [anti-slop](https://github.com/dmmulroy/anti-slop) quality gate

Public `Session` methods stay as specified in `specs/2026-09-18-logview-technical-design.md`. Effect is the implementation substrate behind that boundary.
