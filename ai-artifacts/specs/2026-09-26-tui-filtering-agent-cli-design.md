# Design: one filter language for the TUI and an agent CLI

Status: draft for Iury's review. Date: 2026-09-26. Branch: `feature/tui-filtering-agent-cli`.

## What we have today

- Matching is already shared. `prepareFilter`, `matches` and `matchesLocal` live in `@logcayo/core/filters.ts`. The engine uses them for both arrivals and re-filter jobs. Package filters resolve names to UIDs in the engine, because that needs I/O.
- Parsing from text is not shared. The only string-to-`FilterSpec` path is `commitDraft` in `core/interaction.ts`. It reads the TUI's five-field form (level, tag, PID, package, text). The CLI only has `--filter-text`, which sets the text field.
- No filter can move between the TUI and the CLI. The TUI has no single-line form of a filter, and the CLI has no flag for level, tag, PID or package.
- Headless mode (`cli/src/headless.ts`) waits for the source to end and prints one `summary` line containing the whole snapshot. It prints no events. An agent can learn counts, not logs.
- The `Session` API exposes only the viewport rows (`snapshot().rows`). Nothing can read the matched events by position.

TUI observations, from `ui:verify --scenario filter` and the source:

| Observation | Where |
|---|---|
| Status shows `15 events`, which is retained, not matched. With a filter active you cannot tell how many rows match. | `chrome.ts` `formatStatus`, `paintStatus` |
| Zero matches renders an empty list with no explanation. | `app.ts` `paintLogRows` |
| Text search applies only on Enter. There is no live feedback while typing. | `interaction.ts` `reduceInteraction` |
| There is no key to clear filters and no undo. Clearing means opening the form and deleting five fields. | `interaction.ts` |
| The matched substring is not highlighted. | `color.ts` `paintSpan` |
| Every frame starts with `ESC[2J` (clear screen), then repaints. This flickers under fast arrivals. Identical frames are still written. | `app.ts` `paint` |
| Mode badge, filter chips and help overlay already exist and work. Scroll anchoring on filter commit already exists (`navigation.ts` `filter-committed`). | keep |

## Decision 1: a filter query language in core

Add `packages/core/src/query.ts`. It is the only text-to-filter parser. The TUI and the CLI both call it.

```ts
export type QueryError = Readonly<{
  kind: "invalid-filter";
  field: FilterField | "query";
  message: string;
  offset: number;          // code-unit offset into the query, for a caret
}>;

export function parseFilterQuery(query: string): Result<FilterSpec, QueryError>;
export function formatFilterQuery(spec: FilterSpec): string;   // canonical form
export function textMatchRanges(text: string, spec: FilterSpec): readonly TextSlice[];
```

Grammar (whitespace separates terms):

```text
query  = term*
term   = key ":" value | value
key    = "level" | "tag" | "pid" | "pkg"
value  = bare | '"' (char | '\"' | '\\')* '"'
```

- `level:W` means warning and above. It accepts `V D I W E F ALL`, any case. It reuses `parseLevelField`.
- `tag:Database` is an exact tag match. `pid:4321` is a positive integer. `pkg:com.example.app` is a package name.
- Any other term is text. Text terms are joined with one space, so `lock timeout` searches for `lock timeout`. Use quotes for exact spacing or for text that looks like a key: `"tag:x"`.
- A key that appears twice is an error. The alternative, last one wins, hides mistakes.
- Words with a colon that are not keys stay text. `http://host` is text. `lvl:W` is text and shows as a text chip, so the typo is visible.
- The parser returns a `FilterSpec` that has already passed `prepareFilter`. Invalid states, such as a PID of 0 or an unknown level, never reach the engine.

Contract: for every valid spec, `parseFilterQuery(formatFilterQuery(spec))` equals `spec`. A property test enforces it. The canonical form orders keys `level tag pid pkg`, then text.

Why a language and not more CLI flags: flags cannot be pasted into the TUI. One string can move both ways unchanged: `logcayo query rec.lvr.jsonl 'level:W tag:Database lock'` and `/` then `level:W tag:Database lock` in the TUI.

## Decision 2: TUI changes

Each change is justified by an observation above. Anything not listed is out of scope.

1. **`/` opens a single-line query editor.** It is pre-filled with `formatFilterQuery(activeFilter)`. Plain words still mean text search, so the old habit keeps working. `f` keeps the structured form.
2. **Incremental apply in text mode.** Each edit dispatches `set-filter` when the draft parses. The engine already cancels superseded filter jobs through `requestedRevision`. Esc restores the filter that was active when the editor opened. Enter keeps the draft. A parse error shows inline with a caret, and the last valid filter stays applied. Jev mode stays commit-on-Enter, because each apply calls a paid API.
3. **`x` clears all filters and `u` undoes the last filter change.** History is a bounded list (20) in `InteractionState`. Up and Down in the query editor recall earlier queries from the same list.
4. **Counts.** The status line shows `4 of 15` when a filter is active, using `stats.matchedEvents`.
5. **Empty state.** With zero matches, the list shows `No events match level:W tag:Foo · x clear · u undo`.
6. **Match highlighting.** Text matches in the message get a highlight background. Ranges come from core `textMatchRanges`, so the TUI cannot disagree with the matcher. If case folding changes the string length, nothing is highlighted. That is a safe fallback.
7. **`c` copies the current query.** This is the bridge to the CLI.
8. **No flicker.** Replace `ESC[2J` with cursor-home plus full-width overwrite, wrap each frame in synchronized output (`ESC[?2026h`/`l`), and skip writing a frame identical to the last one.
9. Update help overlay and footer hints for the new keys.

## Decision 3: agent CLI as `logcayo query`

It extends `headless.ts`. It builds the same `Session` with the same replay or ADB source and the same `initialFilter`. It adds no second matcher.

```text
logcayo query PATH  [QUERY] [--limit N] [--since TIME] [--format ndjson|text] [--allow-partial]
logcayo query --live [QUERY] [--serial S] [--timeout DUR] [--limit N] [--since TIME|DUR]
logcayo query --check QUERY        # validate and print the canonical query and spec
```

- **Engine addition**: `Session.readMatches(after: EventId | null, limit: number): readonly LogEvent[]`. It is read-only and walks the active index. It is the one new public contract.
- **Loop**: subscribe, then on each publish read matches after the cursor and write them. Stop on the first of: `--limit` reached, `--timeout` elapsed, source ended and filter settled, or SIGINT. Then print one summary and stop the session.
- **Output**: NDJSON by default.
  - `{"v":1,"type":"event","id":..,"time":"ISO","epochMicros":..,"level":"W","pid":..,"tid":..,"uid":..,"tag":"..","message":"..","continuations":[..]}`
  - The last line is `{"v":1,"type":"summary","query":"<canonical>","emitted":N,"matched":N,"stop":"eof|limit|timeout|signal","terminal":{..},"evictedBeforeRead":N}`.
  - `--format text` prints raw logcat lines, like grep.
  - Errors are one JSON line on stderr: `{"v":1,"type":"error","kind":"invalid-filter","field":"pid","message":"..","offset":4}`.
- **Exit codes**: they match the existing CLI. `0` means completed, including zero matches. `1` means source failure. `2` means invalid arguments or an invalid query.
- **Bounds**: live defaults to `--timeout 10s`, and the summary reports it. `--since` accepts an absolute ISO time or epoch for any source. A relative duration such as `5m` is valid only with `--live`, because it is relative to now. It filters buffered logcat history. For replay, a relative duration is rejected with exit `2`.
- **Read-only**: `query` never writes a file. `record` stays the only writer.
- **Help**: `logcayo query --help` includes the grammar, three examples and the exit codes.
- `replay --headless` keeps its current one-line summary for compatibility.

## Decision 4: architecture guards

Extend `tests/architecture/import-boundaries.test.ts`:

- CLI source has no static import of `@logcayo/tui`. The single dynamic `import("@logcayo/tui")` in `main.ts` is allowed.
- The TUI and the engine never import `@logcayo/cli`.
- Outside core, no source imports `parseLevelField`, `parsePidField` or `foldText`. Filter text is parsed only through `parseFilterQuery`.
- Packages import each other only through the package entry point (`@logcayo/core`), never `../core/src/...`.

## Decision 5: one contract table, two adapters

`tests/contract/filter-cases.ts` lists `{ query, expectedIds }` cases against `tests/fixtures/synthetic/hello.lvr.jsonl` and the sanitized fixture. Two tests consume it:

- CLI: runs `main(["query", fixture, query])`, parses NDJSON and compares IDs.
- TUI: drives `reduceInteraction` key by key into a `Session` with `ManualScheduler`, then compares matched IDs through `readMatches`.

If the adapters ever disagree, one of these two tests fails.

## Work split

| Step | Who | Where | Files |
|---|---|---|---|
| 1. `query.ts`, property and round-trip tests, contract table | coordinator | this worktree | `core/src/query.ts`, `core/test/query.test.ts`, `tests/contract/filter-cases.ts` |
| 2a. Engine `readMatches` and `logcayo query` | worker `cli` (gpt-6-sol) | `~/dev/worktrees/logview/agent-cli` | `engine/src/{contracts,session}.ts`, `cli/src/*`, `cli/test/*`, README CLI section |
| 2b. TUI items 1 to 9 | worker `tui` (grok-4.7) | `~/dev/worktrees/logview/tui-query` | `core/src/interaction.ts`, `tui/src/*`, `tui/test/*`, baselines only via `ui:update` after my review |
| 3. Architecture tests, integration, verification | coordinator | this worktree | `tests/architecture/*` |
| 4. Demo: terminal recordings, animated explainer, diagrams | coordinator plus one worker | `ai-artifacts/demo/` | new files only |

Steps 2a and 2b run in parallel in separate worktrees. They share no files except `core/src/index.ts` exports, which I merge.

## Out of scope

- Regex or boolean operators (`OR`, `NOT`) in the query language. The grammar leaves room for them.
- Time as a filter field in the TUI.
- Changing the capture profile or recording format.

## Open questions for Iury

1. Is `/` becoming a full query line acceptable, with plain words still meaning text? The alternative is a new key such as `:` and leaving `/` unchanged.
2. Is `pkg:` acceptable, or do you prefer `package:`? I will accept both only if you want aliases.
3. Should live `query` default to `--timeout 10s`, or require an explicit bound?
