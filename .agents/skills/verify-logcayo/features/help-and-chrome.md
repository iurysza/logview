# Help and chrome

The header, filter line, and footer stay on screen while the user reads logs. Help lists the keys. Narrow and tiny terminals must stay readable.

## Sub-features

- `help-open` replaces the list body with the key list.
- `chrome-narrow` keeps `logcayo` and `15 events` on one 48-column header.
- `chrome-minimum` shows the resize warning below 40×8.
- `chrome-no-color` paints a plain screen when color is disabled.

## How to get to it (user POV)

- Press `?` to open help.
- Resize the terminal to 48×12 and to 39×7.
- Run the app with `NO_COLOR=1`, or launch a Terminal Control session with `color: "never"`.

## Driving it with ui:verify

Preconditions:

- `bun .agents/skills/verify-logcayo/doctor.ts` reports `ok`.
- Use a unique `--out` directory for each named scenario below.

- **Help.** Run `bun run ui:verify --scenario help --out generated/ui/help`. After `?`, `generated/ui/help/final/screen.txt` contains `Keys` and `t / p        from inspect`.
- **48-column header.** Run `bun run ui:verify --scenario sizes --out generated/ui/sizes`. `generated/ui/sizes/columns-48/screen.txt` line 1 contains `logcayo`, ends with `15 events`, and is 48 columns wide.
- **Minimum size.** The same `sizes` run resizes to 39×7. `generated/ui/sizes/final/screen.txt` contains `Terminal too small`.
- **No color.** Run `bun run ui:verify --scenario no-color --out generated/ui/no-color`. `generated/ui/no-color/final/screen.snapshot.json` has no span whose colors differ from the default foreground and background.
- **Highlights.** Run `bun run ui:verify --scenario highlight --out generated/ui/highlight` when you need color proof. The snapshot has a Catppuccin red `E` and the text `token=REDACTED`.
- **Proof.** Inspect the PNG for each scenario you ran. Help covers the list. The 48-column header still names the app. The 39×7 frame is the warning, not a clipped layout. The no-color frame is unstyled.

## Gotchas

- Help is an overlay, not a separate process. `?` again, Escape, or Enter closes it. `q` quits the app.
- The minimum-size warning keeps ingestion running. Replay at instant speed has already ended, so you will not see new rows appear behind it.
- `NO_COLOR` is a launch setting. Toggling it after the session starts is not a user path.
- Pixel PNGs inherit the emulator background. A dark screenshot does not prove light-background contrast. Use styled cells for pass/fail.
