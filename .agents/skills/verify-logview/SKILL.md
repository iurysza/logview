---
name: verify-logview
description: Drive the logview TUI and CLI the way a user does. Use when proving replay, inspect, filters, help, chrome, quit, or headless live/replay behavior, or when you need PNG, text, and styled-cell evidence from the real app.
---

# Verify logview

Logview is a keyboard-driven Android log viewer. The surface a user touches is the terminal UI. The same CLI also prints one JSON summary in `--headless` mode. This skill drives those paths. It does not start a real `adb` server or a physical device.

Read `features/README.md` before a drive. Use the matching feature file as the recipe. A proof that uses one convenient entry point is incomplete when the map lists others.

## Launch

There is no long-lived server. Install dependencies once, then start each drive in its own isolated Terminal Control session or CLI process.

From the repository root:

```sh
bun install
bun .agents/skills/verify-logview/doctor.ts
```

Default TUI command for a named scenario:

```sh
bun run ui:verify --scenario NAME --out generated/ui/NAME
```

Named scenarios: `replay`, `inspect`, `help`, `filter`, `sizes`, `highlight`, `no-color`, `quit`.

`ui:verify` launches:

```text
<bun> packages/cli/src/main.ts replay tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl --speed instant
```

Ready signal: the visible screen contains `REPLAY • END`. Instant replay finishes before that marker appears. Do not treat text that existed earlier in the PTY byte stream as proof of the current screen.

Default headless command:

```sh
bun run logview replay tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl --speed instant --headless
```

Ready signal: the process exits and stdout is one JSON object with `version: 1` and `kind: "summary"`.

Teardown is the session or process you started. See Cleanup.

## Doctor

Run this read-only check first, and again after any failed drive:

```sh
bun .agents/skills/verify-logview/doctor.ts
```

It answers whether this checkout is worth driving. It checks Bun 1.4+, the pinned Terminal Control `0.4.1` binary, and the sanitized replay fixture. It does not start the TUI.

`@logview/tui` lists the four Terminal Control platform packages as optional dependencies. `bun install` should install the one that matches this OS and CPU. If doctor still cannot resolve `termctrl`, rerun `bun install` from the repository root. Do not add the native package as a required dependency. Do not use a `termctrl` from `PATH`.

A session you launched is healthy when:

- the current visible screen contains `logview` and a mode label such as `REPLAY • END` or `REPLAY • BROWSE`
- the viewport matches the size you requested
- `doctor.ts` still reports the pinned `termctrl` and fixture

Refuse to drive:

- a Terminal Control session you did not start
- a real `adb` device or a user's live capture
- a session whose last action failed until you doctor it and reset to a known state

If doctor fails because this skill drifted, fix the skill under `.agents/skills/verify-logview/`, then retry once.

## Drive

Prefer the named `ui:verify` scenario for TUI features. Use the CLI for headless proof. Use the public `Session` API with `ManualScheduler` only for state that a completed replay cannot reach.

Stable handles are visible strings and keys, not coordinates:

| Handle | Meaning |
|---|---|
| `REPLAY • END` | Instant fixture replay finished. Tail mode. |
| `REPLAY • BROWSE` | User left tail. Incoming events do not steal the selection. |
| `Edit text:` | `/` opened the text-filter draft. |
| `Edit minLevel:` | `f` opened the filter editor on the first field. |
| `t filter tag` | Inspector is open. |
| `Keys` | Help overlay is open. |
| `N/15 shown` | Footer match count against the fixture's 15 admitted events. |
| `Terminal too small` | Viewport is below 40×8. |
| `▸` | Selected row marker. |

Send keys through the helpers in `packages/tui/test/support/ui-capture.ts`. `send(session, ["text:/"])` types `/`. `send(session, ["enter"])` presses Enter. `send(session, ["text:Database"])` types that string. Wait for the next visible acknowledgement before the next key. `keyFromText()` in the app accepts one known sequence or one character per stdin chunk. A burst can drop characters.

Do not add sleeps. Do not search historical PTY output. Wait with `waitForText` or `waitForScreen` on the current alternate screen.

Do not run `bun run ui:update`. That command writes `packages/tui/test/baselines/`.

Do not import `@logview/tui` or start ADB from headless tests. `bun run check` stays headless on purpose.

Working directory must be the repository root. Relative fixture and `--adb` paths resolve from there.

## Evidence

Save proof under `generated/ui/<run-id>/`. That directory is gitignored. Cleanup must not delete it.

`ui:verify` writes one directory per checkpoint:

| File | Use |
|---|---|
| `screen.txt` | Cheap visible-text check. |
| `screen.snapshot.json` | Styled-cell comparison against `packages/tui/test/baselines/<scenario>/`. |
| `screen.png` | Visual review. |
| `screen.json` | Full cell dump for diagnosis. |
| `screen.meta.json` | Fixture, viewport, revision, Bun, and Terminal Control versions. |

A passing named scenario still keeps the final PNG and companions in `--out`. `bun run test:ui` deletes its own `--out` after a pass. Use `ui:verify` when you need retained evidence.

Proof standards:

- Exercise the real CLI or TUI path. Do not set filters through `Session.dispatch` and then claim a keyboard proof.
- Capture the action and the resulting state. A final screen alone is not enough when the map names intermediate states.
- Confirm side effects. Quit must restore the terminal and exit `0`. Headless must print the summary and use the documented exit code.
- Wait for the current screen. A marker that appeared before the action does not prove the action.
- Mocks are allowed only at the existing ADB boundary: `tests/support/adb-stubs/<name>`. Do not fake the TUI, the parser, or the replay fixture.

On a baseline mismatch, `ui:verify` keeps actual cells and a property-level diff next to the checkpoint. Inspect those before changing anything. Only `bun run ui:update --scenario NAME` may write a baseline, and only after you review the PNG and the snapshot diff.

## Cleanup

Stop the Terminal Control session or CLI process you started. `ui:verify` already calls `session.stop()` and `terminal.close()` in `withTerminalSession`.

Do not kill by process name. Do not run `pkill logview` or `pkill termctrl`.

Leave `generated/ui/` in place. Remove only scratch sessions you created under `sessions/` if you recorded something. The default recipes do not write recordings.

After cleanup, confirm the evidence files still exist at the `--out` path you named.

## Helpers

```sh
bun .agents/skills/verify-logview/doctor.ts
```

Read-only environment check. Exit `0` prints `ok` and the Bun version, `termctrl` path, and fixture path. Exit `1` prints the first failed check.

```sh
bun run ui:verify --scenario NAME --out generated/ui/NAME
bun run test:ui
bun run logview replay tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl --speed instant --headless
```

`ui:verify` is the TUI harness. `test:ui` runs capture-policy tests, public-`Session` state tests, and every named scenario that already has a reviewed baseline under `packages/tui/test/baselines/`. Headless CLI is the non-TUI harness.

Keep the map honest with `maintain-verification-skill` after user-facing behavior changes.
