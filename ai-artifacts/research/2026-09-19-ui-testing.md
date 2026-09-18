# Visual testing for logview

## Recommendation

Keep Bun tests and use Terminal Control for agent-driven terminal checks. Compare visible text and styled cells automatically. Save PNGs at named checkpoints for visual review, and record timelines only when a failure or demo needs them.

Do not migrate the UI to OpenTUI or introduce another test runner just to get screenshots. The installed `termctrl` already captures this application without source changes.

This is research, not an approved implementation design. No application code, test configuration, or dependencies changed. Jack researched the alternatives independently. The parent audited the repository and ran the local experiments below.

## What the repository actually tests

Inspected `main` at `0000f6beb8edede327a9c1cd216ba4d6da538542`.

| Current mechanism | What it proves | What it misses |
|---|---|---|
| Public `Session` tests with `ScriptedSource` and `ManualScheduler` | Ingest, navigation, filters, and deterministic state transitions | Terminal rendering and input transport |
| `packages/tui/test/app.test.ts` | Selected strings, plain frame dimensions, key decoding, and a color escape | Complete screen appearance, styled-cell layout, real input chunking |
| `packages/tui/test/highlight.test.ts` | Selected highlighting and control-character sanitization | Placement and clipping in the real terminal |
| Python PTY driver and smoke test | Launches the actual CLI, sends keys, and captures output bytes | Current visible screen, visual baselines, screenshot evidence, reliable synchronization |
| `bun run check` | Configured to run lint, TypeScript, and headless tests | Does not include `packages/tui` tests |

The UI is currently direct ANSI output, not OpenTUI. `attachTui()` in `packages/tui/src/app.ts` manages raw input, alternate-screen mode, resizing, and `process.stdout.write()`. `packages/tui/package.json` has no OpenTUI dependency. README and design references to OpenTUI do not describe the current implementation.

The PTY test searches the accumulated byte stream. Text that appeared earlier can satisfy an assertion even when the final screen is wrong. Its driver uses fixed sleeps, prints the child wait status without enforcing successful child exit, and does not check terminal restoration. The test title promises more than its assertions establish.

Useful existing foundations are `layoutFrame()`, `reduceInteraction()`, the public `Session` API, and `tests/support/scenario.ts`. Reuse them rather than introduce another application-state model.

## Local evidence

Experiments used macOS, Bun `1.1.34`, and `termctrl 0.4.1`. README requires Bun 1.4+, so these are exploratory results on an older runtime, not release acceptance.

The fixture was `tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl`, replayed at instant speed. Its manifest describes an invented, reviewed AOSP-shaped stand-in, not a private device capture.

The following checks worked:

- launch the real CLI in a PTY and wait for `REPLAY • END`
- save PNG, visible text, and JSON containing cell coordinates, widths, colors, and attributes
- open the inspector at 120×24, then resize to the 72×16 overlay
- open help and the search editor
- apply a filter by waiting for each character to appear
- inspect the 39×7 minimum-size warning and the 48×12 layout
- record named moments and regenerate the inspector PNG from the recording

Repeated PNG and cell JSON captures of the unchanged screen were byte-identical. A fresh process at the same size also produced identical PNG and JSON files. The inspector PNG reconstructed from its recording matched the live capture byte-for-byte.

A fresh 120×24 capture took 0.84 seconds. The 48×12 capture took 0.49 seconds. These are individual local observations, not a cross-platform benchmark.

The 120×24 artifacts were 171,200 bytes for PNG, 1,611 bytes for text, and 1,322,683 bytes for pretty-printed cell JSON. The JSON compressed to about 17 KB. Keep raw cell dumps as diagnostic artifacts. Use a compact, readable snapshot representation for committed baselines.

### Problems exposed

1. `bun run test:tui` produced 10 passes and one failure. The PTY smoke did not find `t filter tag`. This was one observed run, not a flake-rate measurement.
2. Sending `Database` as one text burst left the search editor empty. Sending it with 35 ms pacing produced only `Dab`. Sending one character and waiting for its visible acknowledgement worked. `keyFromText()` accepts one known sequence or one character per stdin chunk. Real PTYs can combine or split input. Pacing must not become the permanent fix.
3. At 48 columns, the first visible line became `lvr.jsonl 15 events`, losing the application title and status. A fresh process reproduced it. The ANSI branch of `paintStatus()` emits the untruncated label, unlike the plain branch. Keep this as a regression case and verify the fix on the supported runtime.
4. `bun run check` stopped at lint with `createWorkspace ... GenericFailure, oneshot canceled` and `Wrap finalizer for PromiseRaw failed`. It did not reach TypeScript or headless tests. The runtime mismatch needs resolving before treating this as a project regression.
5. One-shot `termctrl show/save` failed to resolve a relative CLI path without explicit `--cwd` in this environment. Supplying the repository cwd fixed it. The repository wrapper must set cwd explicitly.

All named sessions created for this research were stopped. No software was installed or upgraded.

### Saved screenshots

Evidence is local under `generated/ui-testing-research/2026-09-19/`, which the existing `.gitignore` excludes:

- [Replay at 120×24](../../generated/ui-testing-research/2026-09-19/01-replay-120x24.png)
- [Wide inspector](../../generated/ui-testing-research/2026-09-19/02-inspect-120x24.png)
- [Narrow inspector](../../generated/ui-testing-research/2026-09-19/03-inspect-72x16.png)
- [Help](../../generated/ui-testing-research/2026-09-19/04-help-72x16.png)
- [Lost search input](../../generated/ui-testing-research/2026-09-19/05b-search-paced-loss.png)
- [Applied filter](../../generated/ui-testing-research/2026-09-19/06-filter-applied.png)
- [Minimum-size warning](../../generated/ui-testing-research/2026-09-19/07-too-small.png)
- [Broken narrow header](../../generated/ui-testing-research/2026-09-19/11-fresh-48x12.png)

Each screenshot has text and cell JSON alongside it. `replay.termctrl` retains the interaction timeline. `check.log` records the quality-command failure. These ignored files will not travel with a Git checkout.

## Tool comparison

Capabilities below come from primary documentation and package metadata. Only Terminal Control 0.4.1 was exercised against logview.

| Tool | Best use here | Trade-off | Decision |
|---|---|---|---|
| [Terminal Control](https://github.com/anomalyco/terminal-control) | Agent inspection, PTY interaction, cell snapshots, PNG evidence, replayable recordings | Baseline comparison needs Bun assertions or a small wrapper. Fonts and backend affect images. Persistent sessions support macOS and Linux | First choice |
| [Tuistory](https://github.com/remorses/tuistory) | Named sessions agents and humans can share, text waits, screenshots, interactive debugging | Adds a daemon and an OpenTUI-based dependency stack. Text snapshots and PNG capture do not provide a complete styled-cell comparison workflow | Alternative if shared human sessions become the main need |
| [Microsoft tui-test](https://github.com/microsoft/tui-test) | Built-in styled snapshots, text/style locators, screenshots, failure traces, Windows support | Major rewrite in beta. New JS bindings describe Bun support as best effort | Reconsider for Windows or richer locator requirements |
| [VHS](https://github.com/charmbracelet/vhs) | Scripted demos, README GIFs, PNG checkpoints, text goldens | Requires ttyd and ffmpeg. Batch tapes are less convenient for an agent's live inspection loop | Optional demo tool, not the default test layer |
| [asciinema](https://docs.asciinema.org/manual/cli/) | Compact terminal recording and replay | Does not drive interactions or assert screen state. Pixel output needs another renderer such as agg | Not needed for the proposed workflow |
| [OpenTUI test renderer](https://opentui.com/docs/core-concepts/testing/) | In-memory component rendering and interaction when the app uses OpenTUI | Cannot test this app's current renderer without changing the implementation | Use if OpenTUI is adopted for product reasons |

These tools run locally without a per-screenshot service fee. Setup, runtime, artifact storage, and maintenance are the relevant costs. The proposed checks do not require a model call. Agents can read text after actions and request images only for visual review.

### Versions matter

Registry metadata checked during this research:

- installed Terminal Control CLI: `0.4.1`
- `@kitlangton/terminal-control` latest: `1.2.1`
- `tuistory` latest: `0.11.0`
- `@microsoft/tui-test` latest: `0.0.4`, beta: `0.1.0-beta.4`

[Terminal Control 0.4.1](https://github.com/anomalyco/terminal-control/blob/v0.4.1/README.md) uses `vt100`. Version 1.2.1 uses the Ghostty terminal core and adds capabilities absent from the installed CLI. Do not attribute current-main mouse or semantic-snapshot support to the tested version.

The [TypeScript client](https://github.com/anomalyco/terminal-control/blob/v1.2.1/docs/typescript-client.md) packages native binaries for macOS and GNU/Linux on arm64 and x64. Those packages avoid a local Rust/Zig build. Building 1.2.1 from source requires Rust, Zig, and the pinned Ghostty sources. Video export requires ffmpeg separately.

The TypeScript API exposes text, frames, failure artifacts, and recordings. Its Vitest matchers are optional. A Bun integration should first prove the base API works with Bun assertions and explicit teardown. That integration was not tested here.

Microsoft's [new JS documentation](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md) describes the beta rewrite, not npm's default `latest`. Its `expectSnapshot` supports styles, but Bun support is best effort. Avoid installing the old generation while following the new documentation.

## Proposed repository workflow

The smallest implementation has 2 test layers and one evidence convention.

### Fast frame tests

Use existing scripted sessions, manual scheduling, and interaction reducers to reach states through public behavior. Render those states with `layoutFrame()`.

Assert text, geometry, and styling. Feed the ANSI frame through the pinned terminal parser for styled-cell checks instead of comparing raw escape sequences. Different escape streams can produce the same screen, while plain text alone misses broken colors and selection fills.

If the UI later adopts OpenTUI, use `createTestRenderer()`, `captureCharFrame()`, and `captureSpans()` here. Keep the PTY layer unchanged.

### A small real-PTY suite

Launch the actual CLI against deterministic recordings. Use input, resize, and visible-state assertions. Capture the visible alternate screen rather than search historical output.

Replace fixed sleeps with expected state transitions and bounded settling. A marker that already existed before an action does not prove that action completed. Fail on deadline fallback rather than accepting a partial screen as a valid baseline.

Cover burst input, split escape sequences, quit, exit status, and terminal restoration explicitly. Preserve the real input failure rather than hide it with typing delays.

### Evidence at named checkpoints

Every feature scenario names the states it verifies. A checkpoint saves:

- visible text for cheap agent inspection
- styled cells for exact layout and color comparisons
- PNG for human or agent visual review
- fixture, viewport, source revision, runtime, renderer version, and capture settings

On failure, retain actual and expected frames, a readable cell diff, PNGs, and optional recording. A cell diff should name the row, column, and changed property. A PNG diff can help review, but should not be the initial cross-platform pass/fail gate.

A successful feature verification should still save its final PNG. Intermediate success images and video can be opt-in to control storage and agent context cost.

Suggested commands, not implemented:

```sh
bun run test:ui
bun run ui:verify --scenario inspect --out generated/ui/inspect
bun run ui:update --scenario inspect
```

Use one scenario definition for assertions and evidence capture. `ui:update` must be an explicit action after review, never an automatic response to a failure. Missing tools should fail with setup guidance rather than silently skip verification.

Keep `bun run check` headless. Add a separate required UI check in CI instead of importing terminal dependencies into core or headless tests. Make the feature-completion instructions require `ui:verify` for visual changes.

## Coverage and determinism

Start with a focused scenario set rather than every state at every size:

| Area | Checkpoints |
|---|---|
| Navigation | Tail selection, browsing, page movement, return to tail |
| Inspector | Overlay and split pane, 119/120-column boundary, multiline event |
| Filters | Focus, draft, validation error, applied filter, zero matches, cancellation |
| Chrome | Help, long label, clipped footer, 40×8 minimum and below minimum |
| Source state | Empty source, EOF, retained logs after failure, pending filter and lag notices |
| Text and color | Severity, selection fill, highlights, control escapes, CJK, combining text, emoji, `NO_COLOR` |

Use manual scheduling for transient states. A completed replay cannot exercise every live or pending state.

Pin fixture contents, terminal dimensions, environment, renderer version, and capture settings. Pixel comparisons also require a controlled OS image, font files and fallbacks, cell geometry, scale, and background palette. The app inherits its terminal background, so a dark screenshot does not prove light-background legibility. Confirm palette control before promising that matrix.

Styled-cell comparisons avoid font rasterization noise, but still depend on the emulator's Unicode width and grapheme behavior. Keep CJK and emoji cases explicit. A rendered PNG is evidence from that emulator and font set, not proof of identical appearance in every terminal.

Baseline changes need review against the intended design. Otherwise the first baseline merely preserves existing bugs.

## OpenTUI inspection if adopted later

The documented in-memory renderer provides keyboard and mouse helpers, resizing, frame text, styled spans, and controlled render passes. `TestRecorder` can retain multiple frames. Always destroy the renderer during teardown.

[Rendering diagnostics](https://opentui.com/docs/test-and-debug/rendering-diagnostics/) provide scheduler state, native cell-update counters, buffer dumps, an on-screen stats overlay, and input logging. Span capture has limits around full grapheme clustering and hyperlink IDs. Test it alongside the real PTY, not as a substitute.

## Decision before implementation

Approve a small first slice: standardize the supported Bun runtime, pin one Terminal Control version, add named UI checkpoints and reviewed cell baselines, then replace the Python smoke. Prove the client and artifact workflow on one inspector scenario before expanding coverage.

Do not upgrade Terminal Control and create permanent image baselines in separate unreviewed steps. Its renderer changed between the installed and current versions. Select the version first, then establish the baselines.
