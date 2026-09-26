# Logcayo visual revamp technical specification

## Summary

Status: design proposal, not authorization to implement.

Convert the agreed visual direction into component-level implementation tasks. The user chose the supplied reference over the current Catppuccin Mocha direction and requested tags that match each row's severity.

Use the saved [reference image](../goals/visual-revamp/reference.png) and [visual review checklist](../goals/visual-revamp/reference.md) during implementation review. Compare the terminal content, excluding the macOS window frame.

Keep the current ANSI renderer and `Session` API. Add a fixed column-heading row, share geometry between headings and events, and introduce TUI-local styles for bars, badges, selection, and severity. Preserve existing interaction behavior.

The proposed layout reserves 4 terminal rows instead of 3. This changes the projected row window and page distance at a given terminal height. It does not change ingestion, filtering, event identity, or the headless JSON schema.

## Current State

Inspected on 20 September 2026 at `e12818c`, branch `feature/visual-revamp`.

| Area | Current implementation | Relevant source |
| --- | --- | --- |
| Startup | The CLI creates a source and session, starts the session, then dynamically imports the TUI for a TTY. | [main.ts](../../packages/cli/src/main.ts) |
| Terminal adapter | Direct ANSI output, raw stdin, an alternate screen, and a full-frame write. No OpenTUI dependency or renderable tree. | [app.ts](../../packages/tui/src/app.ts) |
| Screen | Status row, filter row, body, footer. The TUI subtracts a literal `3` from terminal height. | [app.ts](../../packages/tui/src/app.ts) |
| Geometry | Core projection allocates timestamp, level, optional PID, tag, and message fields. No heading row or TID field appears in the list. | [projection.ts](../../packages/core/src/projection.ts) |
| Viewport | `CHROME_ROWS = 3` feeds engine projection and navigation through separate helpers. | [types.ts](../../packages/core/src/types.ts), [contracts.ts](../../packages/engine/src/contracts.ts), [session.ts](../../packages/engine/src/session.ts) |
| Colors | Tags use one muted color. Most low-severity letters are also muted. Selected events and their continuations share a gray background. | [color.ts](../../packages/tui/src/color.ts), [catppuccin.ts](../../packages/tui/src/catppuccin.ts) |
| Message highlighting | URLs, numbers, durations, paths, keywords, and other tokens already have recognition and styles. HTTP methods currently use filled badges. | [highlight.ts](../../packages/tui/src/highlight.ts) |
| Filters | `InteractionState` owns drafts. The editor displays one active field. Enter commits through `Session.dispatch`; Escape discards the draft. | [interaction.ts](../../packages/core/src/interaction.ts), [filters.ts](../../packages/core/src/filters.ts) |
| Inspector | Enter opens an overlay below 120 columns or a split pane at 120 and above. Continuations already appear inline in the list without an expand command. | [app.ts](../../packages/tui/src/app.ts) |
| Source labels | Replay supplies a basename through `SessionSnapshot.label`, not the complete path or an application version. | [main.ts](../../packages/cli/src/main.ts) |
| Visual tests | Named PTY scenarios exist. Only `inspect` currently has reviewed baselines; `test:ui` enrolls scenarios by baseline-directory presence. | [ui-scenarios.ts](../../packages/tui/test/support/ui-scenarios.ts), [ui-scenarios.test.ts](../../packages/tui/test/ui-scenarios.test.ts) |

The initial product document describes an earlier minimal interface. Preserve the public session boundaries in the [technical design](../../specs/2026-09-18-logcayo-technical-design.md) and the existing implementation's inspector and semantic-filter behavior. Do not remove those implemented features to match the older document.

A planning-session capture failed with `unsupported termctrl protocol version 1`. The doctor reported Bun 1.4.2 and Terminal Control 0.4.1, but that version check did not prove protocol compatibility. No current-screen screenshot was captured successfully in that attempt.

## Goals

| ID | Component | Observable result |
| --- | --- | --- |
| V1 | Theme and severity | Cooler dark colors, stronger blue accents, and one severity mapping shared by level letters and tags. |
| V2 | Top bar | App name, source label, source lifecycle, event count, and active-filter summary form readable groups. |
| V3 | Filters | Inactive, applied, focused, invalid, and pending states are distinguishable without changing filter semantics. |
| V4 | Columns and responsive layout | Headings align with their fields. Wide layouts show PID:TID; smaller layouts reduce metadata before message space. |
| V5 | Selection and continuations | A blue band identifies the selected header. A guide and dimmer text connect continuations without competing with the header. |
| V6 | Bottom bar | A filled mode badge, accurate counts, and labelled keycaps make state and supported actions easy to find. |
| V7 | Inspector and help | Both use the same colors and key labels as the main screen. Existing entrypoints and the inspector breakpoint remain intact. |
| V8 | Verification | Retained screenshots and styled-cell assertions demonstrate each change against the user reference. |

Filter badges and the inspector treatment are proposed extensions of the reference's visual language. The image shows a filter count, not an open editor or inspector.

## Non-Goals

- Add a renderer framework, theme picker, configuration schema, or new dependency.
- Change source processing, filter matching, semantic classification, navigation policy, retention, or recording formats.
- Add `r Replay`, inline expansion, mouse interaction, animation, or wrapped log rows.
- Display the reference's sample version, counts, full path, or `NORMAL` mode as real application data.
- Add a selected-rank or percentage API. Event IDs are not filtered ranks or line numbers.
- Reproduce window controls, shadows, font smoothing, or rounded window corners owned by the terminal application.
- Repair unrelated navigation or terminal-tooling defects as an undocumented part of the visual work.

## Invariants and Constraints

1. Core remains free of Bun, OpenTUI, ANSI codes, filesystem access, processes, and clocks.
2. The engine owns history, selection, filtering, and source lifecycle. The TUI receives snapshots and sends existing commands.
3. `Session`, `SessionCommand`, `SessionSnapshot`, `LogEvent`, `ViewRow`, `RowSpan`, and `InteractionState` keep their current shapes. Reuse the existing `pid` span role for PID:TID.
4. The `resize` command continues to receive physical terminal dimensions. Do not subtract control rows before dispatching it.
5. Use one shared chrome-height constant. At supported sizes, projection, paging, and TUI body height agree on `rows - 4`.
6. Keep the minimum terminal size at 40 columns by 8 rows and the inspector breakpoint at 120 columns.
7. Fit unstyled text before adding ANSI codes. Use existing Unicode-width and control-byte escaping functions, not JavaScript string length.
8. Every supported frame occupies exactly the requested rows and columns in both color modes. Fill blank cells as well as populated cells.
9. `NO_COLOR` and `FORCE_COLOR=0` emit no styling. Visible text, selection markers, and editor focus remain meaningful.
10. Filter counts derive from the committed `activeFilter`. Drafts and `pendingFilter` never masquerade as committed filters.
11. Keep literal text whitespace, exact tag matching, PID validation, minimum-level semantics, and semantic-query behavior unchanged.
12. Render only the supplied viewport rows. Do not fetch all retained events or introduce a timer-driven render loop.
13. Keep source failure visible even during browsing or inspection. Replay completion keeps retained logs available.
14. The supplied PNG is a design reference, not an automated test baseline. Never replace it with a generated screenshot.

## Alternatives

### A. Change only ANSI colors in the existing functions

- Types and interfaces: leave all types, row projection, and `layoutFrame` unchanged.
- Ownership: add colors inside `app.ts`, `color.ts`, and `highlight.ts`.
- Call stack: existing `SessionSnapshot -> layoutFrame -> paintRow -> stdout`.
- Failures and cancellation: unchanged source, filter, and terminal cleanup behavior; styling adds no failure path.
- Persistence and transactions: none added; filter activation remains an engine operation.
- Tests: existing painter tests plus new styled-cell expectations.
- Cost and risk: smallest patch, but it cannot provide a real heading row and PID:TID without duplicating or changing layout calculations. It leaves the flat control structure largely intact.

This is suitable for a color refresh, but it does not meet V2, V4, and V6 together.

### B. Keep ANSI output and share pure presentation geometry

- Types and interfaces: extend `ColumnLayout` additively, add a pure column-heading projection, and introduce TUI-only styled text segments. Keep session contracts unchanged.
- Ownership: core owns field widths and unstyled row projection; the TUI owns colors, control composition, and terminal effects.
- Call stack: `SessionSnapshot -> layoutFrame -> chrome and row painters -> ANSI -> stdout`.
- Failures and cancellation: use existing `CommandError`, `UiError`, and source-status variants. Pure presentation functions add no retries, asynchronous work, or cancellation obligations.
- Persistence and transactions: no application persistence changes. Draft commit and filter replacement stay in the existing reducer and engine.
- Tests: pure geometry tests, public-Session state tests, painter tests, and real PTY scenarios.
- Cost and risk: a small cross-package geometry change requires updated row-window expectations. ANSI reset and clipping behavior need explicit tests.

### C. Move rendering and layout into a component renderer

- Types and interfaces: keep the engine snapshot as input, then create adapter-private renderable rows, panes, and native key events. Translate key events into existing interaction inputs.
- Ownership: a new renderer adapter owns native objects, layout, focus integration, and disposal. The engine still owns application state.
- Call stack: `SessionSnapshot -> renderable reconciliation -> native renderer -> terminal`, with native input translated back through `reduceInteraction`.
- Failures and cancellation: translate renderer setup failures into `UiError`; dispose native resources and subscriptions on quit. Avoid a second selection or scrolling authority.
- Persistence and transactions: no new application storage, but additional runtime resource lifetime and package installation concerns.
- Tests: retain headless tests and add native renderer setup, key translation, resize, and cleanup contract tests.
- Cost and risk: new dependencies, larger startup and cleanup changes, and a second layout implementation to reconcile. It provides no necessary capability for this reference.

## Recommendation

Choose B. It addresses every visual component without replacing a working terminal adapter or changing the public session API.

Add only 2 production modules: `theme.ts` for styles and `chrome.ts` for control-line composition. Keep inspector content composition and terminal lifecycle in `app.ts`. Reuse the current highlighter's token recognition.

Reserve 4 rows in every supported layout:

| Row | List | Narrow inspector | Wide inspector | Help |
| --- | --- | --- | --- | --- |
| 0 | Top bar | Top bar | Top bar | Top bar |
| 1 | Filter badges or editor | Filter badges | Filter badges | Filter badges |
| 2 | Column headings | Event heading | Column headings, divider, Event heading | Keys heading |
| 3 through `rows - 2` | Log rows | Event details | Log rows and event details | Help content |
| `rows - 1` | Bottom bar | Bottom bar | Bottom bar | Bottom bar |

The heading row is structural, not an extra border plus a heading. Avoid consuming more log space with decorative separator rows.

## Domain Model and Types

### Existing application values

Use the current types rather than creating a second UI state machine:

```ts
// Existing shapes, unchanged.
type PaintStyle = "plain" | "ansi";

type ViewState = Readonly<{
	mode: "tail" | "browse";
	topId: EventId | null;
	selectedId: EventId | null;
	newSincePause: number;
}>;

// LogMetadata already supplies pid, tid, and level.
// ViewRow already supplies kind, selected, level, spans, and classification.
// InteractionState already distinguishes list, filters, inspect, and help.
```

A source lifecycle and an interaction mode are different values. For example, a completed replay remains `REPLAY • END` in the top bar while its bottom badge changes to `BROWSE`.

### Shared column geometry

Extend the current pure layout result rather than adding TID to the session API:

```ts
// packages/core/src/projection.ts
export type ProcessColumn =
	| Readonly<{ kind: "none"; width: 0 }>
	| Readonly<{ kind: "pid"; width: 5 }>
	| Readonly<{ kind: "pid-tid"; width: 11 }>;

export type ColumnLayout = Readonly<{
	showPid: boolean;
	process: ProcessColumn;
	tagWidth: number;
	messageWidth: number;
	messageColumn: number;
}>;
```

Keep `showPid` for compatibility with existing callers. `layoutColumns` derives it from `process.kind !== "none"`; it is not a separate decision.

Use the current width breakpoints, with the level field widened to hold its heading:

| Field | Allocation |
| --- | --- |
| Selection marker | Existing 2 cells |
| Timestamp | 12 cells, then 2 spaces |
| Level | 3 cells, then 2 spaces; center the single severity letter under `LVL` |
| Process below 58 columns | Hidden |
| Process at 58 through 89 columns | PID in 5 cells, then one space |
| Process at 90 columns and above | PID:TID in 11 cells, then one space |
| Tag | Existing maximum of 8, 12, or 16 cells at those width bands |
| Message | Remaining cells after the tag and its 2-space gap |

Retain the existing tag allocation formula, `min(tagMax, floor(remaining * 0.28))`, and its minimum-message-space adjustment. Compute `remaining` after the new level and process widths. Define the field widths once inside the core projection module.

Format PID:TID from the event metadata. Right-align the combined value within its field. Clip oversized values with the existing ellipsis behavior; keep complete values in the inspector and retained event. Do not allow long numeric fields to push the tag and message out of alignment.

### TUI-only presentation values

```ts
// packages/tui/src/theme.ts
// Reuse Rgb and CellStyle from catppuccin.ts; do not duplicate ANSI helpers.
export type ThemeToken =
	| "canvas" | "bar" | "chip" | "selection"
	| "text" | "muted" | "subtle" | "accent"
	| "green" | "amber" | "red" | "cyan" | "purple";

export const THEME: Readonly<Record<ThemeToken, Rgb>>;
export function severityStyle(level: LogLevel | null): CellStyle;

// packages/tui/src/chrome.ts
export type ChromeSpan = Readonly<{
	text: string;
	style: CellStyle;
}>;

export type ChromeLine = readonly ChromeSpan[];

export type KeyHint = Readonly<{
	key: string;
	label: string;
}>;
```

These are presentation values, not public session records. `ChromeSpan.text` contains unstyled text. The painter escapes and fits it before emitting terminal sequences.

Proposed initial colors follow the agreed direction. Confirm them against retained screenshots before baseline approval.

| Token | Hex | Use |
| --- | --- | --- |
| canvas | `#111820` | Log body and blank cells |
| bar | `#1D2633` | Top, filter, heading, and bottom rows |
| chip | `#273447` | Keycaps and active filter backgrounds |
| selection | `#1C2E4A` | Selected event header background |
| text | `#C3CDE8` | Main text |
| muted | `#8796B5` | Metadata and continuation text |
| subtle | `#52627F` | Guides and separators |
| accent | `#4596FF` | App name, selected marker, primary mode badge |
| green | `#7EE787` | Debug, info, and running source status |
| amber | `#F4C95D` | Warnings and browse state |
| red | `#FF6778` | Errors, fatal events, and failures |
| cyan | `#35D4EA` | Links and useful message values |
| purple | `#C792EA` | Secondary message-token distinctions |

`severityStyle` maps unknown and V to muted, D and I to green, W to amber, and E and F to red. E and F use bold text. Tags and level letters call the same function. An active minimum-level badge uses that level's style; a tag-filter badge has no inherent severity and uses the ordinary active-filter style.

Leave the official `MOCHA` palette and existing ANSI helper types intact. Switch logcayo painters to `THEME`; do not silently redefine Catppuccin colors.

## Interfaces and APIs

### Core projection

```ts
// Existing entrypoints retain their signatures.
export function layoutColumns(columns: number): ColumnLayout;
export function logViewportHeight(rows: number): number;
export function projectEventRows(
	event: LogEvent,
	selectedId: EventId | null,
	columns: number,
): ViewRow[];
export function projectRows(
	events: readonly LogEvent[],
	selectedId: EventId | null,
	columns: number,
	maxRows?: number,
): readonly ViewRow[];

// New pure presentation entrypoint.
export function projectColumnHeader(columns: number): readonly RowSpan[];

// packages/core/src/types.ts
export const CHROME_ROWS = 4;
```

`projectColumnHeader` returns fitted `TIME`, `LVL`, `PID` or `PID:TID`, `TAG`, and `MESSAGE` spans using the same geometry as events. Include the blank 2-cell marker gutter exactly once. Event spans continue to exclude the marker; `paintRow` still obtains it through `markerFor`.

The TUI paints all heading spans with heading styles, not event severity styles. Headings are not `ViewRow` events and do not enter `SessionSnapshot.rows` or counts.

At supported dimensions, `logViewportHeight`, engine `visibleLogRows`, and the TUI body budget return the same height. Keep the existing below-minimum warning behavior; no new dimension parser or error variant is needed.

### TUI composition

```ts
// packages/tui/src/chrome.ts
export function paintChromeLine(
	spans: ChromeLine,
	columns: number,
	style: PaintStyle,
	background: Rgb,
): string;

export function activeFilterCount(filter: FilterSpec): number;
export function sourceStatusText(
	snapshot: Pick<SessionSnapshot, "sourceKind" | "source">,
): string;
export function keyHints(interaction: InteractionState): readonly KeyHint[];

export function paintStatus(
	snapshot: SessionSnapshot,
	columns: number,
	style: PaintStyle,
): string;
export function paintFilterLine(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	columns: number,
	style: PaintStyle,
): string;
export function paintFooter(
	snapshot: SessionSnapshot,
	interaction: InteractionState,
	columns: number,
	style: PaintStyle,
): string;

// Existing text helpers remain available from app.ts through re-exports.
export function formatStatus(snapshot: SessionSnapshot): string;
export function formatFilter(snapshot: SessionSnapshot): string;
export function formatFooter(
	snapshot: SessionSnapshot,
	interaction?: InteractionState,
): string;
export function formatHints(interaction?: InteractionState): string;
```

Omitted interaction arguments use list focus. Text helpers and painters share component text construction, so labels cannot drift between plain and ANSI rendering.

`paintChromeLine` measures, escapes, clips, and pads text before painting. Every span and padding run has its intended background. A reset from one span cannot expose the terminal's default background inside a bar. Plain mode produces the same visible text without any SGR sequences.

Component functions decide which groups fit before calling the line painter. Do not concatenate already-painted strings and then truncate them.

### Component contracts

#### Top bar

- Place `logcayo` and `snapshot.label` on the left. Use the existing label, including the replay basename; no CLI change is required.
- Place source lifecycle, retained-event count, and committed-filter count on the right.
- Derive source status only from `sourceKind` and `source`: `IDLE`, `STARTING`, `PLAYING` for running replay, `RUNNING` for running live, `END`, or `FAILED`.
- Prefix status with `REPLAY` or `LIVE`. Preserve `REPLAY • END` as the completed-replay readiness text, including during browsing.
- Use a colored dot plus text. A dot alone never communicates state.
- Fit full groups first. Reduce the source label first, then omit it, then omit the filter count. The badges below still expose filter state.
- If needed, remove decorative separators or compact the status spacing. Preserve the app name and source lifecycle. Show the event count atomically or omit it; never clip digits into a different count.
- At the existing 48-column fixture checkpoint, retain `logcayo` and the complete `15 events` count.

#### Filters

- Count non-null minimum level, tag, and PID plus nonempty text. Text containing literal spaces still counts as active.
- Display all 4 committed fields when they fit. Inactive values remain muted; applied values use raised backgrounds and readable labels.
- On overflow, retain active fields before inactive fields, preserving schema order within each group. Shorten long values before omitting active fields. If active fields remain hidden, reserve a `+N` summary for their count.
- Keep `/` for literal text and `~` for semantic text. Do not infer semantic mode from the query contents.
- In editor focus, render the active draft first with `Edit Level:`, `Edit Tag:`, `Edit PID:`, or `Edit Text:`. Mark focus with a visible text cue as well as color.
- Show the other draft fields when space remains. At narrow widths, keep the active field and omit the others; Tab behavior does not change.
- Display `interaction.error.message` beside the editor. Reserve space for the error before optional fields and long draft content. Use the error's field to identify invalid input even if another field has focus.
- Enter and Escape retain their current reducer behavior. Invalid input keeps the draft and committed filter unchanged.
- When the engine reports `applying-filter`, keep committed badges and their count until `activeFilter` changes. Show the pending notice separately.

#### Bottom bar

Derive a display badge from existing state. Filters, inspector, and help focus take precedence and display `FILTER`, `INSPECT`, and `HELP`. List focus displays `TAIL` or `BROWSE`. These labels create no new application modes.

Use a blue primary badge, amber browse badge, and readable contrasting text. Keep matched/retained counts, unseen arrivals, semantic progress, and existing notices available when space permits. Counts mean events, not screen rows.

Full-width list hints use labelled keycaps for movement, paging, inspection, text search, filters, tail, help, and quit. Preserve actual keys. Context-specific hints are:

| Focus | Actions to advertise |
| --- | --- |
| List | `↑↓ Move`, `PgUp/PgDn Page`, `Enter Inspect`, `/ Search`, `f Filters`, `G Tail`, `? Help`, `q Quit` |
| Filters | `Tab Next`, `Enter Apply`, `Esc Cancel`, `Ctrl+C Quit` |
| Inspector | `↑↓ Move`, `t Tag`, `p PID`, `Esc Close`, `? Help`, `q Quit` |
| Help | `Esc Close`, `q Quit` |

In filter focus, `q` is text input, not Quit. At 40 columns, use `^C Quit` as the compact label and omit `Tab Next` before losing Apply, Cancel, or Quit.

For other modes, remove optional hints in reverse display order while retaining Close where relevant and Quit. Then remove secondary classification totals and counts before clipping a notice. Prefer `? Help` over a partially printed action. If necessary, clip the notice within the remaining cells; never print a partial keycap or numeric count.

Keep priority explicit: editor Apply/Cancel/Quit controls first; otherwise mode, Close/Quit controls, notices and pending/unseen status, counts, then additional hints. On wide terminals, fit the complete useful set rather than truncating it arbitrarily.

#### Log rows and highlighting

Keep these painter entrypoints and signatures:

```ts
export function paintSpan(
	span: RowSpan,
	level: LogLevel | null,
	style: PaintStyle,
	bg?: Rgb | null,
): string;
export function paintRow(row: ViewRow, style: PaintStyle, columns?: number): string;
export function highlightLogText(text: string, bg?: Rgb | null): string;
```

- Paint the entire row width with `canvas`, including blank padding.
- Use `selection` only for a selected header. Keep its existing `▸` marker and color it blue.
- Preserve severity and message-token foregrounds on the selected band.
- Paint continuation messages with muted text and their existing guide with `subtle`. Do not run full-strength token coloring over these dimmed list lines.
- Keep the existing continuation limit and `+N more` row. Do not turn Enter into an expand toggle.
- Preserve unknown/unparsed rows and classification markers. Do not invent missing metadata or suppress pending markers through styling.
- Retain token recognition, overlap priority, recursive quoted-content highlighting, and token text. Change color lookup to the reference theme.
- Replace filled HTTP-method backgrounds with foreground emphasis, as in the reference. Token backgrounds must not interrupt the selected-row band.

Use muted timestamps, blue process IDs, subtle gutters, and amber warning spans. Ordinary message text uses `text`. Heading labels use muted bold text.

Use these token colors without adding token kinds or changing matching rules:

| Token | Style |
| --- | --- |
| URL | Cyan scheme and host, green path, purple query keys, cyan query values, subtle delimiters |
| IPv4 | Blue digits and subtle dots |
| UUID | Purple letters, cyan digits, subtle hyphens |
| HTTP method | Green GET/HEAD, amber POST, red DELETE, purple other recognized methods; bold foreground only |
| Severity keyword | The same severity mapping as row levels; TRACE uses the verbose style |
| Boolean or null | Green `true`, red `false` and `null`, retaining italic emphasis |
| Date or time | Purple date digits, blue time digits, muted separators |
| Path | Green segments and subtle slashes |
| Pointer | Cyan digits, purple hexadecimal letters, red `x` |
| Process | Amber name, cyan PID, subtle brackets |
| Quoted text | Amber quotation marks; retain existing recursive highlighting inside |
| Duration | Cyan value and purple unit |
| Number | Cyan |
| Key-value prefix | Muted key and ordinary-text equals sign |

#### Inspector and help

Use the reserved heading row for `Event` or `Keys`. Place content below it. Preserve the inspector's metadata, retained message, continuations, raw text, and classification label.

Use the bar background for the inspector pane at both widths, with a subtle divider in the wide layout. Help uses the canvas background and chip-colored keycaps. Fill unused pane cells with the same background as their content.

Use severity styles for the inspector's level and tag. Use the existing message highlighter for message content. Keep raw text escaped and distinguish its label from metadata.

Move inspector action hints to the contextual bottom bar instead of repeating them in both the pane and footer. The keys and their effects remain unchanged. Update verification recipes that currently wait for `t filter tag` in the pane.

At wide sizes, retain `inspectWidth(columns) = min(48, max(32, floor(columns * 0.36)))` and the one-cell divider. Core rows are still projected at physical terminal width. Generate headings for that same width, then clip both headings and rows to the left pane. Do not independently calculate narrower headings or send synthetic pane dimensions to `Session.resize`.

This preserves the current split-pane projection convention. At 120 columns, the left pane is 76 cells wide; the proposed full-width geometry leaves 25 visible message cells there.

### Failures and unchanged public APIs

```ts
// Existing boundaries, unchanged.
interface Session {
	start(): Result<void, StartError>;
	dispatch(command: SessionCommand): Result<void, CommandError>;
	snapshot(): SessionSnapshot;
	subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
	readonly sourceDone: Promise<SourceTerminal>;
	stop(): Promise<void>;
}

type UiError = Readonly<{ kind: "setup-failed"; message: string }>;

function attachTui(
	session: Session,
): Promise<Result<TerminalAttachment & { done: Promise<void> }, UiError>>;
```

No new application failure type is required. Invalid filter drafts still use `CommandError`. Tiny terminals still use `resize-required`. Pure composition functions perform no external operation and do not add an error wrapper around deterministic text fitting.

Source failures remain typed source values. The CLI owns shutdown after attachment completes; the TUI closes its subscription and restores terminal state. Add no retry policy or animation timer.

## Boundaries and Adapters

| Boundary | Values allowed across it | Keep private |
| --- | --- | --- |
| Source to engine | Existing source packets, statuses, and notices | Process handles, files, terminal styles |
| Engine to core projection | Log events, selected ID, physical columns, row budget | History stores, schedulers, terminal objects |
| Core projection to TUI | Unstyled spans, row kinds, severity, selection, classification | ANSI sequences, theme colors |
| Session snapshot to chrome | Existing counts, committed filter, source state, source label | New copies of history or filter membership |
| TUI interaction to core | Existing normalized keys and selection metadata | Native input buffers and terminal handles |
| TUI painters to stdout | Complete escaped, fitted ANSI frame | Raw log control bytes |
| UI verifier to disk | PNG, text, cells, snapshot, metadata | User device captures and credentials |

The only new persistence consists of test fixtures and reviewed visual evidence. Runtime log storage, recording transactions, and filter activation are unchanged. Repainting is a repeatable read of the same snapshot; it does not commit filters or write application data.

Authorization does not change. No new network call or classifier invocation originates in a painter. Headless tests must not import the TUI or start ADB.

## Call Stacks and Data Flow

### Existing startup and drawing

```text
CLI argv
  -> parseArgs -> source construction -> createSession
  -> attachOrHeadless
      -> headless: runHeadless, without importing the TUI
      -> terminal: Session.start -> dynamic import -> attachTui
  -> stdin decoder or Session subscription
  -> reduceInteraction -> optional Session.dispatch
  -> Session.snapshot
  -> layoutLines: status + filters + rows-minus-3 body + footer
  -> paintRow -> ANSI frame -> stdout.write
```

### Proposed drawing and theme

```text
existing CLI and source startup
  -> existing Session subscription or normalized input
  -> Session.snapshot + InteractionState + physical terminal dimensions
  -> layoutFrame/layoutLines
      -> chrome component text -> ChromeLine -> paintChromeLine
      -> projectColumnHeader -> heading styles
      -> snapshot.rows -> paintRow -> severityStyle and highlightLogText
      -> inspector/help composition when focused
  -> exactly rows-by-columns frame
  -> existing stdout.write
```

### Top bar and bottom mode

```text
source packet/status -> Session publication -> snapshot.source
  -> sourceStatusText -> lifecycle group in paintStatus

snapshot.activeFilter -> activeFilterCount -> header filter count
snapshot.stats -> retained/matched count groups
InteractionState + snapshot.view -> display badge and keyHints
snapshot.notice + semantic stats + newSincePause -> footer status groups
  -> width-prioritized ChromeLine -> paintChromeLine -> frame
```

Browsing changes the bottom badge through the existing command path. It no longer hides an ended or failed source behind a combined browse/source label.

### Filter editing, validation, and activation

```text
stdin / or f -> TerminalInputDecoder -> reduceInteraction
  -> filters state with draft -> paintFilterLine and contextual footer

text or Tab -> reduceInteraction -> next draft/focus -> repaint only
Enter -> commitDraft -> parseLevelField/parsePidField/prepareFilter
  -> invalid: CommandError in interaction state -> error styling
  -> valid: existing set-filter command -> Session.dispatch
      -> pending filter job / semantic coordination as currently implemented
      -> snapshot.notice applying-filter + committed badges
      -> engine activates filter -> activeFilter + result snapshot
      -> new committed count and badges
Escape -> discard draft -> list focus -> committed badges
```

Keep existing query replacement, cancellation, and publication semantics. The new chrome observes them; it does not schedule, retry, or cancel jobs.

### Columns, resize, and navigation

```text
terminal resize -> attachTui -> Session.dispatch physical resize
  -> validateDimensions
  -> applyNavigation with logViewportHeight(rows)
  -> buildSnapshot with visibleLogRows(rows)
  -> projectRows -> layoutColumns -> fitted unstyled event spans
  -> layoutFrame
      -> projectColumnHeader using the same physical columns
      -> body height from shared chrome budget
      -> optional identical left-pane clipping
  -> frame -> stdout
```

The engine owns selected IDs and anchors. Opening an inspector changes presentation only; it does not resize the session to the pane width.

### Selection and stack traces

```text
normalized movement key -> reduceInteraction -> Session move/page command
  -> existing navigation plan -> selectedId -> snapshot row.selected
  -> paintRow
      -> header: blue marker + selected background + severity/token foregrounds
      -> continuation: existing guide + muted text
      -> more: existing continuation-count text
  -> fitted rows -> frame
```

### Inspector, help, and quit

```text
Enter or ? -> reduceInteraction -> inspect/help focus
  -> layoutFrame heading and body composition -> contextual footer
inspector t/p -> reduceInteraction with selection metadata
  -> existing set-filter command -> list focus -> committed-filter flow
Esc/Enter -> existing focus transition -> list layout
q or Ctrl+C where supported -> shutdown
  -> unsubscribe + detach listeners + restore raw mode/cursor/wrapping/screen
  -> attachment.done -> CLI Session.stop -> source and scheduled-work cleanup
```

## Files to Add, Change, or Delete

All paths below are relative to the repository root. No production files are deleted.

| Action | File | Responsibility |
| --- | --- | --- |
| Add | `packages/tui/src/theme.ts` | Reference palette and the shared severity-style function. |
| Add | `packages/tui/src/chrome.ts` | Styled control lines, text helpers, filter counts, source lifecycle text, key hints, and width-aware header/filter/footer composition. |
| Change | `packages/tui/src/app.ts` | Compose the 4-row chrome layout; use shared painters; restyle inspector/help; preserve terminal lifecycle and existing helper exports. |
| Change | `packages/tui/src/color.ts` | Apply theme and severity styles to rows, selected headers, continuations, and all padding cells. |
| Change | `packages/tui/src/highlight.ts` | Use reference-theme token colors and remove conflicting token backgrounds without changing recognition. |
| Change | `packages/core/src/projection.ts` | Shared level/process widths, PID:TID projection, additive `ColumnLayout`, and `projectColumnHeader`. |
| Change | `packages/core/src/types.ts` | Set the shared `CHROME_ROWS` value to 4. |
| Change | `packages/core/src/index.ts` | Export `ProcessColumn` and `projectColumnHeader`. |
| Add | `packages/tui/test/chrome.test.ts` | Public control-line composition, focus, status, counts, and narrow-width tests. |
| Add | `packages/tui/test/color.test.ts` | Severity equality, selected backgrounds, continuation styles, and plain-mode parity tests. |
| Change | `packages/tui/test/app.test.ts` | Frame dimensions, helper compatibility, pane headings, and layout expectations. |
| Change | `packages/tui/test/highlight.test.ts` | Token text stability and reference-theme foreground expectations. |
| Change | `packages/core/test/projection.test.ts` | Heading alignment, metadata breakpoints, oversized numeric fields, Unicode, and the 4-row budget. |
| Change | `packages/engine/test/session.test.ts` | Update concrete row windows caused by the new budget; retain selection, filtering, retention, and paging assertions. |
| Change | `packages/tui/test/ui-state.test.ts` | Public-Session source states, editor activation, resize, inspector, and mode-badge scenarios. |
| Change | `packages/tui/test/support/ui-scenarios.ts` | New visual-reference scenario, optional per-scenario fixture, updated visible-state acknowledgements, and expanded checkpoints. |
| Add | `packages/tui/test/fixtures/build-visual-reference.ts` | Deterministic synthetic recording builder using existing recording encoders. |
| Add | `packages/tui/test/fixtures/visual-reference.lvr.jsonl` | Synthetic reference-like replay data; never replace the reviewed 15-event fixture. |
| Change/add after review | `packages/tui/test/baselines/<scenario>/*.snapshot.json` | Only generated through `ui:update`, after reference comparison. |
| Change | `.agents/skills/verify-logcayo/SKILL.md` | Updated scenario list and visible handles. |
| Change | `.agents/skills/verify-logcayo/features/README.md` | Include the new reference-comparison entrypoint. |
| Change | `.agents/skills/verify-logcayo/features/replay.md` | Source lifecycle remains END while the footer enters BROWSE. |
| Change | `.agents/skills/verify-logcayo/features/filter.md` | Human-readable editor labels, badge/error checkpoints, and activation evidence. |
| Change | `.agents/skills/verify-logcayo/features/help-and-chrome.md` | Header fitting, new keycaps, reference comparison, and no-color checks. |
| Change | `.agents/skills/verify-logcayo/features/inspect.md` | Inspector heading and footer action handles. |

No production edits are expected in engine session/contracts, CLI, `interaction.ts`, `filter-form.ts`, `log-list.ts`, or `catppuccin.ts`. Engine helpers already import the shared chrome constant. Other tests that assert exact projected row windows may need updated expectations after the budget change; keep their behavioral assertions.

`tools/ui.ts` already derives valid scenario names from the scenario registry, so adding a named scenario requires no new CLI flag.

## Red-Green Test Plan

Implement one slice at a time after design approval. For each slice, agree on the listed seam, add a failing behavior test, make the smallest production change, then run the focused tests. Do not write all tests before implementing any behavior.

### Prerequisite: restore trustworthy visual capture

Reproduce the existing capture failure with the pinned project workflow. Inspect the resolved JavaScript SDK and native executable as a pair; version output alone is insufficient. Record the actual paths, versions, command, and failure.

Resolve the protocol incompatibility before claiming screenshot verification. Do not upgrade global tools or modify the baseline machinery merely to bypass it. If a dependency or tooling change is needed, propose it separately for approval.

### Slice 1: theme and shared severity

Seam: `paintRow`, `paintSpan`, `severityStyle`, and `highlightLogText`.

Red: render the same tag at V, D, I, W, E, and F. Assert that the level and tag cells share the intended foreground for each severity. Check unknown metadata, error/fatal emphasis, and token text preservation.

Green: add `theme.ts` and replace the relevant palette lookups. Retain token recognition and public painter signatures.

Verify: plain output contains no SGR; stripping painter styling leaves the same fitted text. Test style values and fitted text in the focused painter suite. Check actual level and tag cells through the existing PTY capture helpers in the highlight/reference scenarios. Do not add a second ANSI emulator or rely only on finding a color code somewhere in a row.

### Slice 2: headings and the shared body budget

Seam: `layoutColumns`, `projectColumnHeader`, `projectRows`, public `Session.dispatch`, and `layoutFrame`.

Red: compare heading and data starts at widths 40, 48, 57, 58, 89, 90, and 120. Check centered severity, PID:TID, hidden PID, long tags, oversized PIDs/TIDs, CJK text, and escaped control bytes.

Red: an 8-row terminal has 4 log rows; a page step uses the resulting height. Feed single-row events through the public Session and assert actual selected IDs and row windows.

Green: change shared geometry and `CHROME_ROWS`, add the heading projection, and remove the TUI's literal height subtraction. Update concrete engine expectations for the one-row reduction.

Verify: at 40×8 the app remains usable; at 39×7 it shows the existing warning. At 120 columns with inspector open, heading and log message columns still align after identical left-pane clipping.

### Slice 3: top bar and source lifecycle

Seam: `paintStatus`, `activeFilterCount`, and `layoutFrame` using public-Session snapshots where practical.

Red: running, ended, and failed sources remain identifiable in list, browse, and inspect focus. A replay in browse still shows `REPLAY • END`. Check a long source label, a control byte in a label, large counts, and 0 through 4 committed filters.

Green: extract the chrome painter, compose status groups, and separate lifecycle text from the mode badge. Re-export the existing text helpers from `app.ts`.

Verify: the 48-column fixture retains `logcayo` and `15 events`; no group paints outside the frame or emits a misleading clipped number.

### Slice 4: filter badges, editing, and errors

Seam: `reduceInteraction -> Session.dispatch -> layoutFrame`, with `ManualScheduler` for pending activation.

Red: open with `/` and `f`; distinguish committed values from a draft; cycle with Tab; cancel with Escape; apply with Enter. An invalid PID and invalid level preserve the old filter and display the exact validation error. Include literal whitespace text and semantic-query notation.

Red: on a pending filter job, the header count and committed badges remain tied to `activeFilter`. Switch them only when the engine publishes the activated filter. Do not add a TUI-owned filter cache.

Green: render badges and draft/error styles from the existing values. Preserve reducer and filter-engine semantics.

Verify: PTY checkpoints cover an applied filter, invalid input, cancellation, and zero matches. State-only pending/semantic tests use the public Session, a manual scheduler, and the existing classifier seam without a network provider.

### Slice 5: bottom bar and contextual shortcuts

Seam: `keyHints`, `paintFooter`, and `layoutFrame`.

Red: assert TAIL, BROWSE, FILTER, INSPECT, and HELP badges for existing states. Check notices, matched/retained counts, unseen arrivals, and semantic pending counts. In filter focus, `q` must not be advertised as Quit.

Green: add keycap segments and fit them by the documented priority. Preserve existing keyboard behavior and text-helper call compatibility.

Verify: at 40 columns, editor Apply, Cancel, and Quit remain readable. Wider screens expose more hints without partial keycaps. Every advertised shortcut has a matching reducer behavior test or existing verified entrypoint.

### Slice 6: selected headers and continuation hierarchy

Seam: `paintRow` with real projected event rows.

Red: selected error headers retain a uniform blue background across timestamp, level, tag, message tokens, and trailing padding. An HTTP token cannot punch a different background into the band. Continuation rows are dimmer and keep their guide. More than 6 continuations still produces the existing `+N more` row.

Green: apply selected backgrounds only to headers, use muted continuation styling, and remove filled HTTP-token backgrounds. Keep row identity and continuation projection unchanged.

Verify: compare the selected error screenshot against the saved reference. Check classification markers and plain-mode selection separately.

### Slice 7: inspector and help consistency

Seam: `layoutFrame` with snapshots from the public Session, then actual PTY entrypoints.

Red: Enter opens the existing inspector at 119 and 120 columns; the heading occupies row 2 and the body begins at row 3. Metadata, escaped raw text, continuations, classification, and actions remain accessible. Help lists the actual keys.

Green: restyle pane content and place action hints in the footer. Keep the current split width, overlay breakpoint, and reducer transitions.

Verify: use real keys to open and close both views, move selection, and apply the inspector's `t` and `p` filters. Retain PNGs for both sides of the breakpoint and a narrow layout.

### Slice 8: reference fixture and reviewed visual coverage

Seam: real CLI replay through the pinned Terminal Control PTY.

Add a `visual-reference` scenario at 144×40. Extend the scenario definition with an optional `fixture: string`; default to the existing sanitized fixture. Pass the chosen path to the CLI and record that exact path in capture metadata.

Generate the new fixture with `syntheticRecordingHeader`, `chunkFromPacket`, and `encodeRecordingRecord`. Use 24 parsed events, including the same tag at all 6 levels, long tags, URLs, durations, numbers, booleans, Unicode, and escaped controls. Give the seventh event an error with 8 continuation lines, which exercises the existing 6-line preview and `+2 more`. These events occupy 31 body rows and fit within the 36-row body.

Keep the fixture deterministic and mark it synthetic. Use one stdout packet and a valid EOF footer. Verify it through production replay and the public Session, including the 24-event count, before using it as visual evidence.

Capture an overview and the selected error. Select the error with Home followed by 6 Down presses, then wait for the current selected-header text and BROWSE badge. The screenshot must demonstrate the action's result, not historical PTY output.

Expand existing scenarios with the necessary filter, source-label, sizing, and no-color checkpoints. The existing 15-event fixture already covers all log levels and remains unchanged.

Retain and review evidence for `visual-reference`, `replay`, `filter`, `highlight`, `inspect`, `help`, `sizes`, `no-color`, and `quit`. Add reviewed baselines so `test:ui` exercises these scenarios instead of only `inspect`.

### Acceptance commands and evidence

Run focused tests after each slice. Before acceptance, run:

```sh
bun run check
bun run test:tui
bun run test:ui
bun .agents/skills/verify-logcayo/doctor.ts
```

For each relevant scenario, retain a capture in its own run directory:

```sh
bun run ui:verify --scenario visual-reference --out generated/ui/visual-revamp/visual-reference
bun run ui:verify --scenario filter --out generated/ui/visual-revamp/filter
bun run ui:verify --scenario inspect --out generated/ui/visual-revamp/inspect
bun run ui:verify --scenario sizes --out generated/ui/visual-revamp/sizes
bun run ui:verify --scenario no-color --out generated/ui/visual-revamp/no-color
```

Run the remaining named scenarios the same way. A missing or changed baseline may make verification fail after capture; inspect the saved actual evidence rather than treating that as a rendering verdict.

Review `screen.png`, `screen.txt`, `screen.json`, `screen.snapshot.json`, and `screen.meta.json`. Compare PNGs directly with the saved reference. Use cells for exact foreground, background, alignment, and ANSI/plain parity checks. Record the source revision and any uncommitted implementation diff alongside the evidence, since the current metadata revision alone identifies HEAD.

Only after review, run `bun run ui:update --scenario NAME`, then rerun the quality and UI checks against the reviewed baselines. Do not hand-edit baseline snapshots. Keep the user reference untouched.

Use no sleeps, historical-output assertions, physical devices, or real ADB processes. Public-Session state tests use `ManualScheduler`; input, resize, quit, and exit checks use the real PTY. Assert terminal restoration and exit code 0 on quit.

## Risks and Open Questions

- The capture protocol mismatch blocks live visual acceptance. Its root cause has not been established; a passing version check is not proof that it is fixed.
- The extra heading reduces the log window by one row, including headless projections. Expect changed top anchors and page distances at the same physical height; do not describe all headless output as unchanged.
- Existing navigation counts event ranks, while projection counts continuation screen rows. This may already hide a selected event behind multiline output. Reproduce any such failure against the unchanged implementation before attributing it to this revamp. Escalate a required navigation fix separately rather than enlarging this spec silently.
- Wide inspection currently clips full-terminal-width projections. This proposal deliberately preserves that ownership. Independently reflowing the left pane would need a separate layout contract.
- The reference contains mixed tag-color rules. The user's explicit severity-matching request takes precedence over those inconsistent pixels.
- Narrow terminals cannot show every counter and shortcut. The component fitting priorities are part of acceptance, not permission to let ANSI strings overflow.
- The chosen hex values are initial design proposals. Review their contrast and hierarchy in real captures, including no-color mode, before accepting baselines.

Open questions:

1. Does the user approve this component scope and the proposed 4-row layout for implementation?
2. What SDK/native-tool correction resolves the recorded Terminal Control protocol failure without an unapproved tool upgrade?
