# logview

Keyboard-driven Android log viewer. Live capture, recording, and replay share one byte pipeline. The same `Session` API supports headless tests and the optional ANSI terminal UI.

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
bun run logview replay sessions/example.lvr.jsonl --semantic --filter-text "database locks"
bun run logview replay sessions/example.lvr.jsonl --config logview.json
```

`--headless` prints one JSON `HeadlessOutput` line after the source completes. Diagnostics go to stderr. Exit codes: `0` success (including a size-limit recording), `1` source/recording failure, `2` invalid arguments.

## Agent CLI

`query` streams matched events from a recording or live ADB without loading the TUI. It does not write files.

```sh
bun run logview query sessions/example.lvr.jsonl 'level:W tag:Database lock' --limit 20
bun run logview query --live 'pid:4321' --serial DEVICE --timeout 5s
bun run logview query --check 'level:w tag:Database'
bun run logview query sessions/example.lvr.jsonl '~database locks' --limit 5
bun run logview query sessions/example.lvr.jsonl 'level:W database locks' --semantic
```

Terms `level:`, `tag:`, `pid:`, and `pkg:` filter events. Other terms search text. Put `~` before the text to ask Jev instead, as in `level:W ~database locks`; `--semantic` does the same for plain text. Run `logview query --help` for the full grammar. `--since` accepts an ISO-8601 time with timezone or epoch seconds; live queries also accept a relative duration such as `30s`. Live queries time out after 10 seconds unless you set `--timeout`.

Default output is NDJSON: one event per line, then one summary line. An event has `v`, `type`, `id`, `time` (ISO), `epochMicros`, `level`, `pid`, `tid`, `uid`, `tag`, `message`, `raw`, and `continuations`. Events without parsed metadata have null metadata fields. The summary has `query`, `emitted`, `matched`, `stop`, `terminal`, `evictedBeforeRead`, and `timeout_ms` (for live queries). `evictedBeforeRead` estimates unread eviction from the eviction count and last-read ID; it can include nonmatching events. `--format text` sends raw lines and continuations to stdout and the JSON summary to stderr. Exit codes: `0` success, `1` source failure, `2` invalid arguments or query.

A Jev query reads a recording to the end, waits for Jev to score it, and then prints only relevant events. Each event gains `score` (0 to 1) and `verdict` (`relevant`). The summary gains `jev`: `threshold`, `relevant`, `belowThreshold`, `unscored`, and `error`. It uses the same engine `Session` and classifier as the TUI. It needs `TYPESAFE_API_KEY`; without it the command exits `2` with kind `missing-api-key`. If Jev fails and scores nothing, it exits `1` with kind `jev-failure`. Jev queries do not run with `--live`.

## Config file

`live` and `replay` read `logview.json` in the working directory. Pass `--config PATH` to use another file. Flags override the file. Keep `TYPESAFE_API_KEY` in the environment.

```json
{
  "filter": { "text": "database locks" },
  "semantic": {
    "enabled": true,
    "threshold": 0.5,
    "model": "jev-1.13.0",
    "flushMs": 50,
    "batchItems": 100,
    "historyEvents": 100,
    "maxInFlight": 2,
    "maxQueued": 2000,
    "maxRequestBytes": 131072,
    "timeoutMs": 30000
  }
}
```

`semantic.enabled` is the file equivalent of `--semantic`. `--no-semantic` turns it off for one run. `TYPESAFE_DEFAULT_MODEL` overrides `semantic.model` when set.

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

`test:headless` runs **anti-slop** (Oxlint) then core, engine, CLI, architecture, and quality tests. It does not load the terminal UI, start a physical ADB server, or sleep on wall-clock timers. Tests drive the public `Session` API with a scripted source and a manual scheduler.

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

`test:tui` covers chrome, key decoding, the bounded row pool, public-`Session` state transitions, and real PTY scenarios. The PTY scenarios start the CLI with the sanitized fixture. They verify replay navigation, inspector layouts at 120 and 119 columns, help, burst filter input, zero matches, 48-column chrome, the minimum-size warning, highlighting, `NO_COLOR`, quit, exit status, and terminal restoration.

Use the pinned `@kitlangton/terminal-control@0.4.1` workflow for visual checks:

```sh
bun run test:ui
bun run ui:verify --scenario inspect --out generated/ui/inspect
bun run ui:update --scenario inspect
```

`ui:verify` reads the committed styled-cell baseline. It always saves the final PNG, visible text, terminal cells, compact styled snapshot, and metadata to `--out`. Missing or changed baselines fail and save expected cells plus a property-level diff. It never changes a baseline. Run `ui:update` only after you review the generated PNGs and snapshot diff. `ui:update` is the only command that writes `packages/tui/test/baselines/`. Generated evidence stays under the ignored `generated/ui/` directory.

The TUI inherits the terminal background and uses **Catppuccin Mocha** for accents. Header and footer stay fixed. Messages get Tailspin-style highlights after control characters are sanitized. Selection uses a `▸` marker and a full-row fill. Enter inspects the selected event. In the query line, Tab (or Right at the end) accepts the grey fish-style completion for keys and for tag, PID, package, and level values seen in the session. Set `NO_COLOR=1` for a plain dump.

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

Functional core (`@logview/core`) plus an imperative shell (`@logview/engine`). Core has no Bun or terminal imports. The terminal UI is a direct ANSI adapter in `@logview/tui`, and the CLI dynamically loads it only for an interactive terminal. Effect is internal:

- `Either` / `Effect` at session construction, mapped to documented `Result` types at public boundaries
- `Match` for tagged commands and recording records
- `Schema` for recording JSONL and `logview.json`
- `Context.Tag` layers for scheduler, source, files, and processes
- `Effect.scoped` / finalizers for recording and process lifetime

Read [the architecture reference](ai-artifacts/architecture.md) for the implemented package boundaries, session lifecycle, recordings, filtering, semantic queries, terminal rendering, and test seams. `specs/2026-09-18-logview-technical-design.md` remains the original design handoff; source and tests define current contracts.

Natural-language filtering uses TypeSafe **Jev**. Enable it with `--semantic` or `semantic.enabled` in `logview.json`, and set `TYPESAFE_API_KEY`. In the `/` query line, plain text filters live as you type; `~question` asks Jev when you press Enter, because each question is a paid call. A purple ` ✦ Jev ` badge marks Jev in the query line, the filter chips, and the status bar. `m` switches the current text between literal and Jev. `v` hides or dims rows scored below the threshold. When you apply a query, Jev classifies the newest `semantic.historyEvents` locally eligible retained logs, which defaults to 100. New locally eligible arrivals continue to be classified while the query is active. Older rows stay visible with an unrequested icon. Rows scored below the threshold are dimmed. Headless tests never call Jev.

## Scripts

| Script | What it does |
|---|---|
| `bun run test:headless` | anti-slop + headless tests |
| `bun run test:adapters` | process, recording, sanitized fixture, and live-ADB stub tests |
| `bun run test:tui` | TUI chrome, state, and real-PTY tests |
| `bun run test:ui` | Styled-baseline policy, public-`Session` state, and real-PTY UI scenarios |
| `bun run ui:verify --scenario NAME --out PATH` | Verify one named UI scenario and save review evidence |
| `bun run ui:update --scenario NAME` | Explicitly replace one scenario's reviewed styled-cell baseline |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check` | lint + typecheck + headless tests |
| `bun run bench:headless` | fixed-seed ingest, burst, and filter measurement |
| `bun run bench:full` | PRD-scale filter measurement (advisory timings) |

Recordings under `sessions/` are gitignored. Keep synthetic fixtures in `tests/fixtures/synthetic/`.
