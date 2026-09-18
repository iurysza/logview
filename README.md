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

`test:headless` runs **anti-slop** (Oxlint) then core, engine, CLI, architecture, and quality tests. It does not load OpenTUI, start ADB, or sleep on wall-clock timers. Tests drive the public `Session` API with a scripted source and a manual scheduler.

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

## Architecture

Functional core (`@logview/core`) plus an imperative shell (`@logview/engine`). Core has no Bun or OpenTUI imports. Effect is internal:

- `Either` / `Effect` at session construction, mapped to documented `Result` types at public boundaries
- `Match` for tagged commands and recording records
- `Schema` for recording JSONL
- `Context.Tag` layers for scheduler, source, files, and processes
- `Effect.scoped` / finalizers for recording and process lifetime

Public contracts stay those in `specs/2026-09-18-logview-technical-design.md` (`Session`, snapshots, commands, `LogEvent`).

## Scripts

| Script | What it does |
|---|---|
| `bun run test:headless` | anti-slop + headless tests |
| `bun run test:adapters` | process and recording file tests |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check` | lint + typecheck + headless tests |
| `bun run bench:headless` | workload stub |

Recordings under `sessions/` are gitignored. Keep synthetic fixtures in `tests/fixtures/synthetic/`.
