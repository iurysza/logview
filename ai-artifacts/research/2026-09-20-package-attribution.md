# Package attribution and filtering

Status: accepted direction, 20 September 2026

## Decision

Logcayo will use Android UID data for package attribution and filtering.

- add UID to the Logcat capture profile and `LogMetadata`
- resolve package names only when details or a package filter needs them
- cache one package table per live device session
- filter by the UID values resolved from a package name
- store the package table in new recordings
- keep version 1 recordings readable, with package shown as unavailable

The detail panel must always show attribution. It must not invent a package for native processes, shared UIDs, or failed lookups.

## Why UID is the right base

The current `threadtime`, `epoch`, and `usec` profile contains PID and TID, but no package. Android has no package-name Logcat modifier. The documented [`uid` format modifier](https://developer.android.com/tools/logcat#format-modifiers) adds the emitting UID.

PID tracking is weaker for retained logs. Processes restart, PIDs are reused, and buffered entries may outlive their processes. A UID survives process restarts and is part of the captured record. A UID can map to several packages, so the model must keep all matches.

## Evidence from other tools

| Tool | Package method | Limit |
| --- | --- | --- |
| [rogcat](https://github.com/flxo/rogcat/issues/52) | no package resolution | UID resolution remains an open request |
| [adbcat](https://github.com/helviojunior/adbcat/blob/4d5d74d1a9ef7be2f34cc10d652c48bc03ef4e37/pkg/readers/logcat.go#L134-L190) | polls `adb shell ps` every 2 seconds for a selected package | filters current PIDs only |
| [pidcat](https://github.com/borneygit/pidcat/blob/8aa9b67cff4200471ff5cd2d07adc7b2d26055ab/src/filter/pid_filter.rs#L37-L101), [OkCat](https://github.com/Jacksgong/okcat/blob/12e0631a93e5e357d38c3807163eccdec80b1bc3/okcat/adb.py#L174-L299), and [FadCat](https://github.com/anonfaded/FadCat/blob/69bd646bde2960ade181b9bc87d400283d098d83/src/core/pidcat.py#L316-L410) | take a `ps` snapshot, then parse process start and death messages | package filtering, not durable attribution |
| [Logcat-viewer](https://github.com/IzhanAli/Logcat-viewer/blob/8d5ef5eae1c31605f0edff92c93701cdae2d6c0f/src/adb.js#L90-L134) | uses `pidof`, falls back to `ps`, and repolls every 2 seconds | package filtering, not replay-safe attribution |
| [BeautyCat](https://github.com/jeziellago/beautycat/blob/f80e99946bfce5ff9c6078b2b5b0c03f1bcf174f/beautycat/resolver.py#L10-L51) | refreshes a complete PID-to-process map every 2 seconds and annotates new records | can miss short-lived, dead, and buffered processes |

These tools justify package filtering as a product need. Their PID-based designs do not meet logcayo's retained-history and replay requirements.

## Implementation direction

Use this data flow:

```text
adb logcat -v threadtime -v epoch -v usec -v uid
  -> parser stores UID on LogMetadata
  -> details open or package filter requested
  -> Session asks an engine package-resolver port
  -> adb adapter runs cmd package list packages -U
  -> engine caches UID-to-packages and package-to-UIDs
  -> SessionSnapshot publishes resolving, resolved, or unavailable
  -> TUI renders the result
```

The TUI must not run ADB. Opening details must dispatch through the public `Session` boundary. The first lookup loads the package table. Later events use the cache. Refresh the cache when a UID is missing or the device changes.

Package filtering uses the same cache. Keep the package name as the user-facing filter and match events against its resolved UID values. Do not restart Logcat or discard unrelated captured events.

Version the recording format and store the UID-to-packages snapshot with new captures. Replay must use recorded metadata, never a currently connected device.

## Required fallback states

The detail panel must distinguish:

- one package: `com.example.app`
- shared UID: all matching packages
- system or native process: process or UID with no package
- lookup failure: `Unavailable`
- version 1 recording: `Not recorded`

## Scope boundary

This work changes the parser, core event metadata, engine contracts, ADB adapter, filter matching, recording schema, detail panel, and tests. It does not require continuous `ps` polling, ActivityManager message parsing, eager per-event package lookup, or package guesses from tags and messages.
