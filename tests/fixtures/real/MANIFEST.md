# Sanitized real-pattern fixture

File: `sanitized-aosp-pattern.lvr.jsonl`  
Provenance: `sanitized-real`  
Redaction version: `2026-09-18.public-aosp-pattern.v1`  
Profile: `threadtime-epoch-usec-v1`

## Origin

This environment has no authorized Android device. The fixture is a reviewed, redacted stand-in built from public AOSP log shapes (Zygote, ActivityManager, chatty, libc abort, Database) and the canonical `threadtime` + `epoch` + `usec` capture profile.

It is **not** an untouched dump from a private phone. Treat it as a sanitized real-pattern capture for parser, replay, live-stub, and TUI smoke — not as evidence of a specific device session.

A later reviewed recording from a physical device should replace this file, keep the same schema, and bump `redactionVersion`.

## Review

| Class | Result |
|---|---|
| Personal names, emails, phone numbers | None |
| Tokens, cookies, passwords, payment data | `token=REDACTED` only |
| Device serials / IMEI / advertising IDs | None in log text. Replay header stores no serial. |
| Package identity | Invented `com.example.logview.demo` |
| PIDs / UIDs | Invented |
| Control bytes | One escaped ESC sequence in a warning line, to prove display sanitization |

## Packets

Stdout is the UTF-8 logcat text in `sanitized-payload.ts`, split so a multibyte `é` in `café` crosses a packet boundary. Stderr is a diagnostic line that must not become a log event.
