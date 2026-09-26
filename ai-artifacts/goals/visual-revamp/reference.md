# Check the visual revamp against the reference

Use [the user-supplied image](reference.png) when reviewing the implementation. The user chose its cooler dark palette and stronger blue accents over Catppuccin Mocha. The image is an unchanged 1448 × 1086 PNG.

The [technical specification](../../specs/2026-09-20-visual-revamp.md) defines the proposed component changes and acceptance tests.

## Compare these details

- [ ] Distinct top and bottom bars separate controls from log content.
- [ ] The top bar groups the app name, source label, source status, counts, and filter summary.
- [ ] Column headings align with their data, including PID:TID where space permits.
- [ ] Each tag matches its row's severity color, as the user requested. The image itself mixes severity colors and fixed tag colors.
- [ ] A blue selection band and bright left marker identify the selected event without hiding severity or message highlights.
- [ ] Dimmer continuation text and a vertical guide make stack traces subordinate to their parent event.
- [ ] A filled mode badge and labelled keycaps make the bottom bar easy to scan.
- [ ] Message highlights distinguish useful values without coloring every word.
- [ ] Active filters and editor focus remain easy to identify. The image shows a filter count, not an open editor.

## Keep the comparison within scope

Compare the terminal content, excluding the macOS title bar, window frame, and shadows. Preserve real data, supported shortcuts, and actual mode labels. Do not copy sample counts, the version number, `Enter Expand`, or `r Replay` as new requirements.

This reference records the visual direction. It does not authorize implementation or new interaction behavior.

## Collect implementation evidence

1. Read the `verify-logcayo` skill and its feature map.
2. Run `bun .agents/skills/verify-logcayo/doctor.ts`.
3. Capture the relevant named scenarios with `bun run ui:verify --scenario NAME --out generated/ui/NAME`.
4. Inspect each saved PNG beside `reference.png`.
5. Check the accompanying text, styled cells, and metadata for alignment, colors, viewport size, and source revision.
6. Verify narrow layouts and `NO_COLOR` separately.
7. Record remaining visual differences before accepting the implementation.

Keep this image separate from automated baselines. Only `bun run ui:update --scenario NAME` may update baselines after evidence review.

The planning-session capture attempt failed with `unsupported termctrl protocol version 1`, despite a passing doctor check. Resolve that blocker before claiming live visual verification.
