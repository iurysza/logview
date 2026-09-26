# Visual revamp handoff

Make logcayo easier to scan using the supplied image. Strengthen the bars, filters, column headings, selection, and shortcut labels. Make each tag match its row's severity.

## Current state

- Checkout: `/Users/iurysouza/dev/worktrees/logview/feature-visual-revamp`
- Branch: `feature/visual-revamp`
- Source revision at handoff: `e12818c`
- No application implementation has started. The user approved the reference-led color direction; the technical spec remains a proposal.
- The planning artifacts are untracked. Preserve them; a fresh checkout will not contain them automatically.

Confirm implementation approval before changing application code. Do not reopen the palette decision unless new evidence requires it.

## Read the artifacts in this order

1. Open [reference.png](reference.png). This is the unchanged user-supplied visual target. Study the separation between bars and content, the blue selection, the mode badge, the keycaps, and the dimmer stack trace.
2. Read the [technical specification](../../specs/2026-09-20-visual-revamp.md). It defines each component's contracts, file changes, data flow, layout rules, and acceptance tests. Use it as the implementation plan rather than reconstructing requirements from chat.
3. Keep [reference.md](reference.md) open during visual review. It is the comparison checklist and explains which screenshot details to ignore.

Also read the repository's `AGENTS.md`, the `coding-standards` skill, and the `verify-logcayo` skill and feature map before working.

The screenshot mixes fixed tag colors and severity colors. Follow the user's explicit request: tags match severity. Do not copy its sample version, counts, line percentage, window frame, `Enter Expand`, or `r Replay` into the product.

## Implement in vertical slices

Follow the spec's red-green sequence. Add one failing behavior test, implement the smallest change, and verify that slice before continuing.

1. Add the reference theme and shared severity styles.
2. Add aligned headings and PID:TID support using shared column geometry. Change the reserved control-row count from 3 to 4 everywhere through the shared constant.
3. Rebuild the top bar. Keep source lifecycle separate from browse or inspector focus.
4. Render filter badges, focused drafts, validation errors, and pending activation from existing state.
5. Add the mode badge and contextual keycaps to the bottom bar.
6. Refine selected headers and continuation rows without changing navigation or expansion behavior.
7. Restyle inspector and help. Preserve the 120-column inspector breakpoint and current key bindings.
8. Add the synthetic visual-reference scenario, collect screenshots, and approve baselines only after comparison.

Keep the existing ANSI renderer. No OpenTUI migration, theme picker, new dependency, or session API change is planned. Core owns pure geometry; the TUI owns styling and terminal effects. Pass physical terminal dimensions to `Session.resize`, not dimensions reduced by the control bars or inspector pane.

Expect one fewer visible log row at the same terminal height. Update concrete row-window and paging expectations without weakening their behavioral assertions.

## Resolve the verification blocker

The earlier `ui:verify` attempt failed with `unsupported termctrl protocol version 1`. Doctor reported Bun 1.4.2 and Terminal Control 0.4.1, but capture still failed.

Check the resolved JavaScript SDK and native executable together. Establish a successful capture before claiming visual verification. Propose dependency or global-tool changes separately; do not bypass the pinned workflow.

Only `inspect` currently has reviewed baselines. A passing `test:ui` does not yet demonstrate coverage of every visual component. The `visual-reference` scenario is specified but has not been implemented.

## Verify and report

Run the required checks after implementation:

```sh
bun run check
bun run test:tui
bun run test:ui
```

Run doctor before PTY captures. Save each scenario under `generated/ui/<run-id>/<scenario>` using `bun run ui:verify --scenario NAME --out PATH`.

Compare each saved PNG with `reference.png`. Inspect its text, cells, snapshot, and metadata too. Cover filters, selection, inspector widths, help, narrow sizes, no-color mode, and quit. Use the public Session and `ManualScheduler` for state tests; use the pinned PTY for actual keyboard and terminal behavior.

Use no sleeps, historical-output assertions, physical devices, or real ADB sessions. Only `bun run ui:update --scenario NAME` may write baselines, after visual review. Never overwrite the user reference.

Finish with the changed components, actual test results, retained evidence paths, intentional visual differences, and any remaining blockers. Report pre-existing defects separately. In particular, the spec flags a possible event-rank versus continuation-row navigation issue; do not silently turn the revamp into a navigation rewrite.

## Open items

- Confirm implementation approval for the proposed scope.
- Resolve the recorded Terminal Control protocol failure before visual acceptance.
