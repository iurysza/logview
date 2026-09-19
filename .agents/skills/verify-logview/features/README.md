# logview verification map

This directory is the maintained source for verifying the user-facing behavior of logview. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Work from the repository root.
- Run `bun install` once in this checkout.
- Run `bun .agents/skills/verify-logview/doctor.ts` and require Bun 1.4+, Terminal Control `0.4.1`, and `tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl`.
- Drive replay against that sanitized fixture at `--speed instant`. It admits 15 events. It is a reviewed AOSP-shaped stand-in, not a private device capture. See `tests/fixtures/real/MANIFEST.md`.
- Use a unique `--out generated/ui/<run-id>` directory for each TUI drive.
- Never drive a Terminal Control session you did not start.
- Never start a real `adb` server or a physical device. Live capture uses `tests/support/adb-stubs/<name>` only.

## Driving conventions

- Start every TUI recipe from a fresh `ui:verify` scenario or a fresh CLI process unless the file names another precondition.
- Prefer named scenarios in `packages/tui/test/support/ui-scenarios.ts` over ad-hoc key sequences.
- Treat every command as literal. Keep fixture paths, scenario names, and stub names unchanged.
- Wait for the current visible screen. Do not inspect historical PTY output. Do not add sleeps.
- Type filter text one acknowledged character at a time when you drive the editor yourself. A single burst can drop characters.
- Restore nothing after a replay drive. The fixture is read-only. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- TUI proof includes `screen.txt`, `screen.snapshot.json`, and `screen.png` from `ui:verify`.
- Headless proof includes the command, the JSON summary line, stderr, and the exit code.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Replay navigation](./replay.md) covers tail, browse, paging, and return to the end.
- [Inspect event](./inspect.md) covers overlay and split-pane inspector layouts.
- [Filter logs](./filter.md) covers the text editor, an applied filter, and zero matches.
- [Help and chrome](./help-and-chrome.md) covers help, the 48-column header, the minimum-size warning, and `NO_COLOR`.
- [Headless CLI](./headless-cli.md) covers replay summary output and live capture against ADB stubs.
