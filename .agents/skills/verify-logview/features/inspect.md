# Inspect event

Inspect opens the selected event so the user can read the full record, with the message wrapped to the available width, then closes back to the list. At 120 columns the inspector sits in a split pane. Below 120 columns it covers the list.

## Sub-features

- `inspect-open` opens the selected event from the list.
- `inspect-split` shows a divider and the list beside the event at 120 columns.
- `inspect-overlay` covers the list at 119 columns and at 72 columns.
- `inspect-close` returns to the list with Escape or Enter.

## How to get to it (user POV)

- Press Enter on a selected list row.
- Resize the terminal across the 120-column boundary while inspect is open.
- Press `t` or `p` in inspect to filter the current tag or PID.
- Press Escape or Enter to close inspect.

## Driving it with ui:verify

Preconditions:

- `bun .agents/skills/verify-logview/doctor.ts` reports `ok`.
- No other recipe is using `--out generated/ui/inspect`.

- **Named scenario.** Run `bun run ui:verify --scenario inspect --out generated/ui/inspect`. The run waits for `REPLAY • END`, presses Enter, then resizes to 119 and 72 columns.
- **Open inspect.** After Enter, the screen contains `Event Details`, `Message`, `Raw`, and `filter by this tag`.
- **Wide split.** `generated/ui/inspect/wide-120/screen.snapshot.json` has `│` at column 71, row 2. The viewport is 120×24.
- **Narrow overlay.** After the resize to 119 columns, row 2 of `generated/ui/inspect/narrow-119/screen.txt` starts with `Event Details` and has no divider at column 71, row 2.
- **Overlay at 72.** `generated/ui/inspect/final/screen.txt` is 72 columns wide, starts its body with `Event Details`, and still contains `日本語 ok`.
- **Close inspect.** The named scenario leaves inspect open. Send Escape or Enter in a follow-up drive. The current screen loses `filter by this tag` and shows the log list again.
- **Proof.** Inspect the three PNGs under `generated/ui/inspect/`. The 120-column frame is a split pane. The 119-column and 72-column frames are overlays.

## Gotchas

- 119 and 120 are different layouts, not a font change. Compare cells, not only the PNG.
- The inspector shows only metadata present in the recording. It does not infer package, process, thread, or logcat-buffer names.
- Opening inspect from an empty selection shows `No event selected`. The sanitized fixture has a selection after replay, so this path needs a different source.
- `t` and `p` apply a filter and close inspect. `y` copies the complete selected event through the same clipboard path as the list. These actions are described in the pane rather than duplicated in the footer.
- Escape and Enter both close inspect. `q` quits the app instead.
