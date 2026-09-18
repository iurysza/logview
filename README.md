# logview

Keyboard-driven Android log viewer. V1 is a **headless engine**: live capture, recording, and replay share one byte pipeline. OpenTUI is an optional later adapter and is not required to test behavior.

## Requirements

- [Bun](https://bun.sh) 1.4+
- An authorized Android device only for live capture (`adb`)

## Commands

```sh
bun run logview live --serial DEVICE
bun run logview record --serial DEVICE --out sessions/example.lvr.jsonl --duration 60
bun run logview replay sessions/example.lvr.jsonl
bun run logview replay sessions/example.lvr.jsonl --speed 4
bun run logview replay sessions/example.lvr.jsonl --speed instant --headless
```

`--headless` prints one JSON `HeadlessOutput` line after the source completes. Diagnostics go to stderr. Exit codes: `0` success (including a size-limit recording), `1` source/recording failure, `2` invalid arguments.

## Capture profile

Live capture uses this argument vector, not a shell string:

```
adb -s <serial> logcat -b main -b system -b crash -v threadtime -v epoch -v usec *:V
```

## Headless development

```sh
bun run test:headless
bun run check
```

`test:headless` runs **anti-slop** (Oxlint) then core, engine, CLI, architecture, and quality tests. It does not load OpenTUI, start a physical ADB server, or sleep on wall-clock timers. Tests drive the public `Session` API with a scripted source and a manual scheduler.

`bun run check` is the default quality path: anti-slop + TypeScript + the same headless tests.

### anti-slop quality gate

This repository vendors [anti-slop](https://github.com/dmmulroy/anti-slop) at `tools/oxlint/anti-slop/` from commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`. There is no npm package; the plugin is local source registered in `oxlint.config.ts`. Companion packages are pinned together:

- `oxlint@1.83.0`
- `@oxlint/plugins@1.83.0`

Effect-specific rules are enabled because `effect` is a direct dependency. `bun run lint` must fail on slop (filter/map chains, unknown parameters, unguarded type assertions, and the Effect tagged-value rules). Provenance: `tools/oxlint/UPSTREAM.md`.

```sh
bun run lint
bun run lint:fix   # readable-spacing autofix, then re-lint
```

## Live ADB smoke

CI uses a fake `adb` at `tests/support/adb-stubs/` so live capture can be exercised without a phone:

```sh
bun run test:adapters
bun run logview live --headless --adb tests/support/adb-stubs/one-device --serial emulator-5554
```

On a real authorized device:

```sh
bun run logview live --serial DEVICE
bun run logview record --serial DEVICE --out sessions/device.lvr.jsonl --duration 10
```

With no device, several devices and no `--serial`, or an unauthorized/offline serial, the command explains the problem and exits `1`.

## Terminal UI

Interactive live/replay loads the TUI only when stdout is a TTY. Replay the sanitized fixture:

```sh
bun run logview replay tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl --speed instant
bun run test:tui
```

`test:tui` covers chrome, key decoding, the bounded row pool, and a PTY smoke that paints the session and sends `↑`, `G`, and `q`.

## Fixtures

- `tests/fixtures/synthetic/` — tiny recordings for schema and CLI tests.
- `tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl` — reviewed sanitized real-pattern capture (`provenance: sanitized-real`). See `tests/fixtures/real/MANIFEST.md`.

## Benchmarks

PRD timings stay **advisory** on shared runners. Structural bounds (visible row count, history charge, drained queue, filter publication) run in `bun run check`.

```sh
bun run bench:headless
bun run bench:full          # 100k-event filter with a 128 MiB history-charge cap
```

Each JSON report records Bun version, OS, CPU, memory, seed, line-size plan, RSS/heap, filter time, and navigation p95. Do not treat a single FPS number as proof of responsiveness.

## Architecture

Functional core (`@logview/core`) plus an imperative shell (`@logview/engine`). Core has no Bun or OpenTUI imports. Effect is internal:

- `Either` / `Effect` at session construction, mapped to documented `Result` types at public boundaries
- `Match` for tagged commands and recording records
- `Schema` for recording JSONL
- `Context.Tag` layers for scheduler, source, files, and processes
- `Effect.scoped` / finalizers for recording and process lifetime

Public contracts stay those in `specs/2026-09-18-logview-technical-design.md` (`Session`, snapshots, commands, `LogEvent`).

Natural-language filtering (Jev) remains specified as a post-storage classifier port. V1 does not add a runtime classifier module.

## Scripts

| Script | What it does |
|---|---|
| `bun run test:headless` | anti-slop + headless tests |
| `bun run test:adapters` | process, recording, sanitized fixture, and live-ADB stub tests |
| `bun run test:tui` | TUI chrome, keys, and PTY smoke |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check` | lint + typecheck + headless tests |
| `bun run bench:headless` | fixed-seed ingest, burst, and filter measurement |
| `bun run bench:full` | PRD-scale filter measurement (advisory timings) |

Recordings under `sessions/` are gitignored. Keep synthetic fixtures in `tests/fixtures/synthetic/`.
