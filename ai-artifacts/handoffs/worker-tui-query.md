# Worker brief: TUI query editor and filtering UX

You work in `~/dev/worktrees/logview/tui-query` on branch `feature/tui-query`. Nobody else writes here.

Read first: `AGENTS.md`, `ai-artifacts/specs/2026-09-26-tui-filtering-agent-cli-design.md` (Decision 2 is your job), `packages/core/src/{query,interaction}.ts`, `packages/tui/src/{app,chrome,color}.ts`, `packages/tui/test/*`, `tests/contract/filter-cases.ts`, and the `verify-logcayo` skill in `.agents/skills/`.

## Build (items refer to Decision 2)

Do them in this order and commit after each group.

**A. Query editor (items 1, 2, 3) in `core/src/interaction.ts`.** Pure reducer, no I/O.
- New focus state `{ focus: "query"; draft: string; cursor: number; error: QueryError | null; origin: FilterSpec; historyIndex: number | null }`. Keep the existing `filters` form for `f`.
- `/` opens it with `draft = formatFilterQuery(activeFilter)`, cursor at end, `origin = activeFilter`.
- Each edit (char, backspace, `edit-field`): parse with `parseFilterQuery`. Valid → emit `set-filter` (incremental) and clear error. Invalid → keep the error in state, emit nothing. Exception: when the session is in Jev mode, do not emit on edits; only on Enter. Pass search mode into the reducer as an argument (default "text") so it stays pure.
- Enter: if valid, emit `set-filter` (if it differs from active) and push the canonical query onto history; back to list. If invalid, stay and show the error.
- Esc: emit `set-filter` with `origin` if the active filter changed, back to list.
- Up/Down: walk history (newest first), replacing draft and applying it like an edit.
- History and undo live in state that survives focus changes. Make `InteractionState` carry `{ history: readonly string[]; undo: readonly FilterSpec[] }` in a small wrapper or a second reduced value; choose the least invasive shape, keep invalid states unrepresentable, and bound both lists to 20.
- List focus: `x` clears all filters (push current onto undo), `u` pops undo and applies it. `c` requests a copy of the canonical query (return a flag/effect in `InteractionResult`, e.g. `effect: { kind: "copy"; text } | null`; the TUI does the clipboard write).
- Every set-filter that comes from the query editor, `x`, `t`, `p` or the `f` form pushes the previous filter onto undo (skip no-ops).
- Filter text parsing anywhere in TUI/interaction goes through `parseFilterQuery` for `/`. Do not add another parser.
**B. Chrome (items 4, 5, 9) in `tui/src/chrome.ts`, `app.ts`.**
- Status: `N of M` when any filter is active (`stats.matchedEvents` of `stats.retainedEvents`), otherwise `M events`. Keep the narrow-width fallback.
- Query editor line: `/ ` + draft with a visible cursor; on error, the message in red and a `^` marker under the offset is optional; at least show `! message` like the form does.
- Empty state: when `rows.length === 0`, `stats.retainedEvents > 0`, and not applying, the first list row reads `No events match <canonical query>` and the next `x clear · u undo`, muted colour.
- Footer hints and help overlay: add `/ Query`, `x Clear`, `u Undo`, `c Copy query`; hints must still degrade by width as today.
**C. Match highlighting (item 6)** in `tui/src/color.ts`: for `message` spans, get ranges from `textMatchRanges(span.text, activeFilter)` and paint them with a highlight background (add `THEME.match`, a muted Catppuccin surface/yellow tint) layered on the existing token highlighting. Plain style: no change. Thread the active filter into `paintRow` without globals.
**D. No flicker (item 8)** in `app.ts` `paint`: remove `\x1b[2J`; write `\x1b[?2026h` + `\x1b[H` + lines (each already padded to full width) + `\x1b[?2026l`; skip the write if the frame string equals the previous one; reset the cache on resize.
**E. Copy (item 7)**: handle the `copy` effect with the existing `copyToClipboard`.

## Tests

- `packages/core/test/interaction.test.ts`: query editor incremental apply, invalid draft keeps last valid filter, Esc restores origin, Enter records history, Up recalls, `x`/`u` round trip, Jev mode defers to Enter, bounds at 20.
- `packages/tui/test/ui-state.test.ts` (or a new `query-contract.test.ts` in `packages/tui/test`): **contract test**. For each case in `tests/contract/filter-cases.ts`, open a replay `Session` of the fixture with `ManualScheduler` (see `tests/support/scenario.ts` and existing ui-state tests), type `/`, clear the pre-filled draft, type the query key by key through `reduceInteraction`, dispatch commands, press Enter, let the filter settle, and assert the matched ids equal `expectedIds`. Read ids through `session.readMatches(null, 1000)` if it exists on your branch; it will not. Instead use rows from a snapshot with enough `rows` to fit all matches (rows: 60). Leave a `// TODO(coordinator): switch to readMatches after merge` note.
- Chrome unit tests for the status count, empty state and hints.
- UI scenarios: existing baselines WILL change (status line, hints). Run `bun run test:ui`, then `bun run ui:verify --scenario NAME --out generated/ui/NAME` for each of `filter help replay sizes highlight`, and inspect the PNGs yourself. Do NOT run `ui:update`. Report which scenarios fail and why; the coordinator reviews and updates baselines.
- Add a new UI scenario `query` if the scenario harness makes that cheap (`packages/tui/test/support`): open `/`, type `level:W tag:Database lock`, Enter. If it is not cheap, skip and say so.

## Rules

- Do not touch `packages/cli/**`, `packages/engine/**`, `tests/architecture/**`, baselines.
- Keep `@logcayo/core` pure. Oxlint clean. `bun run check` and `bun run test:ui` (except expected baseline diffs) must pass.
- Small conventional commits, default author (Iury), no co-author trailer. Do not push.
- Finish with a short report: files changed, commands with results, which baselines changed and why, anything deferred.
