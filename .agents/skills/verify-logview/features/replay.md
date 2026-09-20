# Replay navigation

Replay opens a recording without a phone, lets the user leave the tail to inspect earlier events, and returns to the newest event on `G` or End.

## Sub-features

- `replay-open` loads the sanitized fixture at instant speed and stops in tail mode.
- `replay-browse` leaves tail when the user moves up.
- `replay-page` pages through matching events.
- `replay-tail` returns to the newest event and tail mode.

## How to get to it (user POV)

- Run `logview replay tests/fixtures/real/sanitized-aosp-pattern.lvr.jsonl --speed instant`.
- Press `↑` or `k` to leave tail.
- Press `PageUp` or `Ctrl+U` to page up, and `PageDown` or `Ctrl+D` to page down.
- Press `G` or End to jump to the newest event.

## Driving it with ui:verify

Preconditions:

- `bun .agents/skills/verify-logview/doctor.ts` reports `ok`.
- No other recipe is using `--out generated/ui/replay`.

- **Named scenario.** Run `bun run ui:verify --scenario replay --out generated/ui/replay`. The run waits for `REPLAY • END`, sends a split up-arrow, pages up, then types `G`.
- **Open replay.** The first settled screen after launch shows `logview`, `REPLAY • END`, `sanitized-aosp-pattern.lvr.jsonl`, and `15 events`.
- **Leave tail.** After the up-arrow, `generated/ui/replay/browse/screen.txt` contains `REPLAY • BROWSE`.
- **Return to tail.** After `G`, `generated/ui/replay/final/screen.txt` contains `REPLAY • END` and `日本語 ok`.
- **Proof.** Inspect `generated/ui/replay/browse/screen.png` and `generated/ui/replay/final/screen.png`. The browse frame is not following. The final frame is back at the end and still shows the fixture label.

## Gotchas

- Instant replay reaches `REPLAY • END` before you send keys. Do not send movement before that marker is on the current screen.
- `G` is Shift+g. A lowercase `g` does nothing.
- A split escape sequence (`ESC [` then `A`) is a required case. One burst of `↑` can be decoded as Escape and then discarded.
- The Python PTY smoke searches historical output. Do not use it as proof of the current screen.
