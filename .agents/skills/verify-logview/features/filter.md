# Filter logs

Filters hide events that do not match the active level, tag, PID, or literal text. When Jev is enabled, the text field is a natural-language query. The list keeps every event that matches the level, tag, and PID filters. A new query classifies only the newest 100 locally eligible retained events by default. Older eligible rows show an unrequested icon. The classification column dims scores below the threshold. The footer shows `matched/retained`.

## Sub-features

- `filter-text-open` opens the text draft from `/`.
- `filter-text-apply` commits a literal substring and updates the shown count.
- `filter-zero` shows `0/15 shown` when nothing matches.
- `filter-jev` keeps eligible rows visible and shows their Jev classifications.
- `filter-editor` opens the four-field editor from `f`.
- `filter-cancel` discards a draft with Escape.

## How to get to it (user POV)

- Press `/` to edit the text filter.
- Press `f` to edit `minLevel`, `tag`, `pid`, and `text`.
- From inspect, press `t` to keep only the selected tag, or `p` to keep only the selected PID.
- Press Enter to apply a draft. Press Escape to discard it.

## Driving it with ui:verify

Preconditions:

- `bun .agents/skills/verify-logview/doctor.ts` reports `ok`.
- No other recipe is using `--out generated/ui/filter`.

- **Named scenario.** Run `bun run ui:verify --scenario filter --out generated/ui/filter`. The run waits for `REPLAY • END`, opens `/`, types `Database`, applies it, then replaces the draft with `no-match`.
- **Open text editor.** After `/`, the current screen contains `Edit text:`.
- **Type the query.** After `Database`, the current screen contains `Edit text: Database`. Wait for that whole string before Enter.
- **Apply text.** After Enter, `generated/ui/filter/applied/screen.txt` contains `/ Database` and `4/15 shown`.
- **Zero matches.** After the `no-match` commit, `generated/ui/filter/final/screen.txt` contains `0/15 shown`.
- **Editor entry.** For `filter-editor`, start a fresh session and send `f`. The current screen contains `Edit minLevel:`. Tab walks `minLevel`, `tag`, `pid`, `text`. This path is not in the named `filter` scenario.
- **Cancel draft.** From either editor, send Escape. The list returns and the previous filter line is unchanged.
- **Proof.** Inspect `generated/ui/filter/applied/screen.png` and `generated/ui/filter/final/screen.png`. The applied frame shows four Database rows. The final frame shows an empty list and `0/15 shown`.

## Gotchas

- Text is a case-insensitive literal substring. It is not a regex. `Database` matches the fixture tag. `database locks` is a Jev query only when `--semantic` is on and `TYPESAFE_API_KEY` is set. Default verification does not enable Jev.
- Sending `Database` as one unacknowledged burst can leave `Edit text:` empty or partial. Wait for each visible acknowledgement, or use the named scenario, which already types through Terminal Control and waits.
- `q` typed in the editor inserts `q`. It does not quit. Quit from list or inspect focus, or send Ctrl+C.
- An invalid PID or overlong field keeps the current filter and shows `!` plus the field error. The named scenario does not cover that error.
- `--semantic` turns `/` into `~` on the filter line. The production scenario does not enable Jev because it must not call the external classifier. Use deterministic semantic engine and renderer tests for the 100-event history window, live arrivals, visibility, notes, and dimming.
