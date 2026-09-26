# Worker brief: `logview query` agent CLI

You work in `~/dev/worktrees/logview/agent-cli` on branch `feature/agent-cli`. Nobody else writes here.

Read first: `AGENTS.md`, `ai-artifacts/specs/2026-09-26-tui-filtering-agent-cli-design.md` (Decision 3 is your job), `packages/core/src/query.ts`, `packages/cli/src/{main,headless}.ts`, `packages/engine/src/{contracts,session}.ts`, `tests/contract/filter-cases.ts`.

## Build

1. **Engine**: add `readMatches(after: EventId | null, limit: number): readonly LogEvent[]` to the `Session` interface in `engine/src/contracts.ts` and implement it in `session.ts`. Read-only. Walk the *active* index (published filter only, never a pending one) in id order, return events with id > `after`, at most `limit`. Also expose `filterSettled` via the snapshot if you need it (`pendingFilter === null` already exists; prefer that).
2. **CLI**: `logview query` in `cli/src/main.ts`, logic in `cli/src/headless.ts` (extend it, do not add a parallel module unless headless.ts would exceed ~250 lines; then `cli/src/query.ts` is fine). Surface:
   ```
   logview query PATH [QUERY] [--limit N] [--since TIME] [--format ndjson|text] [--allow-partial]
   logview query --live [QUERY] [--serial S] [--adb PATH] [--timeout DUR] [--limit N] [--since TIME|DUR]
   logview query --check QUERY
   logview query --help
   ```
   - QUERY is parsed ONLY with `parseFilterQuery` from `@logview/core` and passed as `initialFilter`. No other filter parsing anywhere in the CLI. Replay uses `speed: instant`.
   - Loop: subscribe; on each publish, `readMatches(cursor, remaining)` and write. Stop on first of: limit reached, timeout, source terminal AND `pendingFilter === null` AND no more matches, SIGINT/SIGTERM. Then drain once more, write the summary, `await session.stop()`.
   - NDJSON event: `{"v":1,"type":"event","id","time"(ISO from epochMicros, null if no metadata),"epochMicros","level","pid","tid","uid","tag","message","raw","continuations":[]}`. Use `tagText`/`messageText` from core. Unparsed lines: metadata fields null, `raw` set.
   - Summary last line: `{"v":1,"type":"summary","query":<formatFilterQuery(spec)>,"emitted","matched":stats.matchedEvents,"stop":"eof"|"limit"|"timeout"|"signal","terminal":SourceTerminal|null,"evictedBeforeRead":n}`. `evictedBeforeRead` counts ids skipped because history evicted them before read (detect gaps via active index vs cursor; a simple approach is fine; document it).
   - `--format text`: write `raw` then continuations, one per line; summary goes to stderr as JSON.
   - `--check`: stdout `{"v":1,"type":"check","query":canonical,"filter":spec}`, exit 0; invalid → exit 2.
   - Errors: one JSON line on stderr `{"v":1,"type":"error","kind","field","message","offset"}`. Exit codes: 0 ok (zero matches is ok), 1 source failure, 2 bad args/query.
   - `--since`: absolute ISO-8601 or epoch seconds for any source; relative (`30s`,`5m`,`2h`) only with `--live`, else exit 2. Implement as an event-time lower bound applied in the query loop to emitted events (it is not a filter field). For `--live`, `--timeout` defaults to `10s`; report it in the summary as `"timeout_ms"`.
   - Read-only: never write files.
   - `--help` for query: grammar, 3 examples, exit codes. Update top-level `usage()` too.
3. **Tests** (`packages/cli/test/query.test.ts`, `packages/engine/test/session.test.ts` additions):
   - Contract: for every case in `tests/contract/filter-cases.ts`, run `main(["bun","logview","query",FIXTURE,query])` capturing stdout (inject a writer; do not spawn processes), assert event ids equal `expectedIds` and summary `query` equals `canonical`. Every `INVALID_FILTER_QUERIES` entry exits 2 with a JSON error whose `field` matches.
   - `--limit 2` stops with `stop:"limit"`, 2 events. `--check`. `--format text`. relative `--since` without `--live` → 2.
   - Live: use the fake adb in `tests/support/adb-stubs/` with `--timeout`, as `packages/cli/test/live-adb.test.ts` does.
   - Headless tests must not load OpenTUI or start real adb.
4. **README**: add an "Agent CLI" section under Commands with examples and the NDJSON shape.

## Rules

- Do not touch `packages/tui/**`, `packages/core/src/interaction.ts`, `tests/architecture/**`. If you need a core change, stop and tell the coordinator in your final message.
- `bun run check` must pass and oxlint must be clean before you finish. Also run the real thing: `bun run logview query tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl 'level:W'` and paste the output in your final message.
- Commit in small conventional commits, author is the repo default (Iury). No co-author trailers. Do not push.
- Finish with a short report: files changed, commands run with results, anything you deferred.
