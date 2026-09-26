# Detail screen: wrap everything, calm the hierarchy

Worktree: `~/dev/worktrees/logview/detail-screen-wrap` (branch `feature/detail-screen-wrap`).
Scope: `packages/tui/src/inspect.ts`, its tests, one new UI scenario. Do not touch `@logcayo/core`, the fixture, or other baselines.

## Visual direction (binding)

Rule: the detail screen never truncates content with `…`. Every section wraps inside the pane width.

### 1. Word-aware wrapping (shared helper)

Replace the character wrapper with one span-aware wrapper in `inspect.ts`:

```ts
wrapSpans(spans: ChromeSpan[], width: number, first: ChromeSpan[], rest: ChromeSpan[]): ChromeLine[]
```

- `first` is the prefix on the first row, `rest` the prefix on continuation rows (gutter/indent). Available width = `width - prefixWidth`.
- Styles survive a break: a span split across rows keeps its style on both halves.
- Break opportunities, in preference order: after whitespace; after `,` `;` `&` `|`; before `(`; after `.` `/` `:` `=`. Break at the **last** opportunity that fits.
- If no opportunity fits, hard-break at the width (current behaviour).
- Drop whitespace at the start of a continuation row. Never emit a trailing-space-only row.
- Use `escapeDisplayText` units for widths (wide chars, tabs, control escapes). Never split a unit.
- Width ≤ prefix width: fall back to hard break with at least 1 column of content; never loop forever.

### 2. Message

- Body colour: `THEME.text`, not `severityStyle`. Level colour stays on the Level field only.
- No prefix, continuation rows flush left.

### 3. Stack trace

- Frame first row: `│  ` + `at pkg.Class.method` (text) + `(File.java:88)` (cyan).
- Continuation rows: `│    ` (gutter + two extra spaces, subtle).
- Because `(` is a preferred break, the location drops to its own row when the frame is too long. It must never be clipped.
- Caused by / Suppressed / `... N more` / other lines: same wrapping, same continuation prefix.
- Non-stack continuation lines: same, muted.

### 4. Raw

- Colour stays `THEME.subtle`.
- Head line: `trimStart()` the raw text before display (logcat right-aligns epoch seconds with spaces). This fixes the stray indent.
- Continuation raw lines: trim leading whitespace (tabs), render with a 2-space prefix. Their wrapped rows use a 4-space prefix.
- Head line wrapped rows use a 2-space prefix.
- `y` copy is unchanged and still copies the untouched raw text.

### 5. Hierarchy

- Package value: `THEME.muted` when `unavailable` or `resolving`. Amber is for warnings, not missing data.
- One blank row before each section header (Message, Stack Trace/Continuation, Raw). Not before the first field.
- Keep the field label column (12) and section rule style as is.

### Out of scope

Scrolling the inspector, collapsing Raw, changing the header row, the actions block.

## Tests

`packages/tui/test/app.test.ts` (headless, `layoutFrame`):

- Update "inspect wraps the complete message": message rows are word-wrapped, rejoined text equals the message with single spaces, no row starts with a space.
- New: wide split pane (120 cols, pane 48) with a frame longer than the pane. Assert `(Store.java:88)` appears in full and no inspector row contains `…`.
- New: raw head line has no leading spaces when rawText starts with spaces; tab continuation renders as `  at ...`.
- New: unavailable package renders in `THEME.muted`, not amber.
- Existing assertion `styled toContain amber` must still hold for a legit reason (WARN level), or be adjusted honestly.
- Unit test for `wrapSpans` if exported for testing: long no-space token hard-breaks, `a, b` breaks after comma, style kept across break.

## UI scenario

Add `inspect-detail` to `packages/tui/test/support/ui-scenarios.ts` and `UI_SCENARIO_NAMES`:

- Viewport `{ cols: INSPECT_WIDE_COLUMNS, rows: 30 }`, color always.
- Navigate to the ActivityManager `Start proc` event (long message), Enter, capture `long-message`. Assert text contains `MainActivity}` (end of message is visible).
- Navigate to the `Retry after lock timeout` event, capture `stack-trace`. Assert `(Store.java:88)` and `(Store.java:41)` are visible, and no `…` in the inspector columns.
- Use existing helpers (`send`, `waitForText`, `waitForScreen`). No sleeps.
- Check how existing scenarios move selection (keys like `j`/`k`/`g`) before choosing keys.

Then run `bun run ui:update --scenario inspect-detail` to create its baseline, and `bun run ui:update --scenario inspect` because that baseline will legitimately change. Do not update any other baseline. If another baseline diff appears, stop and report it.

## Done when

- `bun run check` passes.
- `bun run test:ui` passes.
- `bun run ui:verify --scenario inspect-detail --out generated/ui/inspect-detail` and `--scenario inspect` pass.
- Report: files changed, commands run with results, paths to the PNGs under `generated/ui/`. Do not commit.
