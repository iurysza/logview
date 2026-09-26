# Logcayo V1 product requirements

Date: 18 September 2026  
Status: Proposed specification. No application implementation accompanies this document.  
Working name: `logcayo`. The public product name remains undecided.  
Companion: [Technical design](2026-09-18-logcayo-technical-design.md).

## Summary

Logcayo is a keyboard-driven Android log viewer. It lets a developer follow incoming logs, stop following to inspect earlier rows, and narrow the view without losing the underlying history.

V1 establishes a reliable, testable engine before it adds a rich interface. The same engine runs against a connected device, a recorded byte stream, or a test source. Its behavior does not depend on OpenTUI or a physical phone.

The later product adds natural-language filtering through Jev. That feature scores individual logs in batches and changes their visibility. It does not delete logs or sit between the source and storage.

## Problem and primary user

An Android developer needs to inspect a busy log stream without fighting automatic scrolling. They also need to reproduce a logging bug after the original device session ends.

The immediate job is: “Show the relevant logs, let me move through them, and keep my place while more arrive.” The later job is: “Show logs related to database access, even when those words do not appear in the message.”

## Scope and requirement basis

The user explicitly requested Bun, TypeScript, an OpenTUI direction, a functional core with an imperative shell, device-free testing, replay, basic filters, stable navigation, tailing, and a later Jev classifier.

This document proposes the exact filter fields, key bindings, limits, recording format, and performance targets. Those details are design decisions, not existing product capabilities or measured results.

No target repository or actual log recording was supplied. This is a greenfield handoff. All paths, commands, and fixtures described below are proposed additions.

## V1 requirements

| ID | Capability | Observable acceptance condition |
|---|---|---|
| P1 | Live source | With one authorized device, start ADB log capture. With no eligible device or several devices, explain the problem instead of choosing arbitrarily. An explicit serial selects the device. |
| P2 | Headless recording | Record stdout bytes, stderr bytes, their order, and relative receipt times into a versioned file without loading a TUI. Recording is a separate command in V1. |
| P3 | Device-free replay | Open a recording without ADB or a phone. Support original timing, a positive speed multiplier, and immediate replay. All modes use the production framer and parser. |
| P4 | Basic filters | Filter by minimum level, one exact tag, one PID, and a literal text substring. Combine active fields with AND. Changes affect retained history and subsequent arrivals. |
| P5 | Stable browsing | Moving upward leaves tail mode. Incoming logs do not move an existing selected event or top event while both remain eligible and retained. |
| P6 | Explicit tail mode | Start at the bottom. `G` or `End` resumes following. Reaching the bottom through downward navigation does not resume following. |
| P7 | Bounded resources | Bound retained history, queued input, individual lines, index storage, and recording size. Expose eviction, truncation, and source failure separately. |
| P8 | Headless behavior tests | Test parsing, replay, filters, selection, tailing, eviction, filter races, and shutdown without importing OpenTUI or loading its native renderer. |
| P9 | Minimal terminal interface | Display source status, active filters, a fixed-height log list, selection, browse or tail state, and keyboard hints. |
| P10 | Useful failure states | Keep retained logs available after disconnection or replay completion. Show a failed source, an empty source, and zero filter matches as different states. |
| P11 | Safe display | Treat log content as text. A message cannot inject terminal control sequences, open links, set the clipboard, or execute commands. |

Package-name tracking, automatic PID refresh after an app restart, and automatic device reconnection are outside V1. A PID filter means a numeric PID, not a stable application identity.

## Initial interface

This wireframe defines information and interaction, not a final visual theme. Row data is illustrative.

```text
┌─ logcayo · replay: database-session ─────────────── SOURCE RUNNING ─┐
│ Level: ALL   Tag: —   PID: —   Text: database                      │
├──────────────────────────────────────────────────────────────────┤
│ 12:41:17.912  I  Database     Opening connection                   │
│ 12:41:18.021  D  Database     SELECT completed in 12 ms            │
│›12:41:18.921  W  Database     Retry after lock timeout             │
│ 12:41:19.019  I  Database     Transaction committed                │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ BROWSE · 143 new since pause · 4,208 matches · 50,000 retained      │
│ ↑↓ move   PgUp/PgDn page   G tail   / text   f filters   q quit     │
└──────────────────────────────────────────────────────────────────┘
```

One stored log line occupies one screen row. Long messages are clipped with a visible marker. The complete retained text still participates in text filtering. Inline expansion, wrapped rows, mouse actions, and detail panes are deferred.

Use restrained level styling and a selection marker that works without color. Never rely on color alone to identify an error or selection. At narrow widths, hide PID and then reduce the tag column before removing message space. Below 40 columns or 8 rows, show a resize message while ingestion continues.

### Keyboard contract

| Input in list focus | Behavior |
|---|---|
| `↑` or `k` | Select the previous matching event. Enter browse mode. |
| `↓` or `j` | Select the next matching event and enter or remain in browse mode. From tail, keep the newest event selected without moving past it. |
| `PageUp` or `PageDown` | Move by the visible row count minus one, with a minimum step of one. Enter browse mode. |
| `Home` | Select the oldest retained match. Enter browse mode. |
| `End` or `G` | Select the newest match and enter tail mode. |
| `/` | Edit the literal text filter. |
| `f` | Edit minimum level, exact tag, PID, and text in a compact form. |
| `q` or `Ctrl+C` | Stop the session and restore the terminal. |

In a filter editor, `Tab` changes fields, `Enter` commits, and `Escape` discards the draft. Typing does not start a history scan. List shortcuts are inactive while the editor has focus. `Ctrl+C` remains a shutdown command.

### Filter semantics

Minimum level uses `V < D < I < W < E < F`; `ALL` disables the level restriction. The tag comparison is exact and case-sensitive. PID is a positive integer. Text is a case-insensitive literal substring of the retained source line, including tag and message. V1 uses deterministic, locale-independent lowercasing, without accent folding or regex syntax.

Empty fields impose no restriction. Whitespace around a structured field is trimmed. Whitespace inside the text field is literal. An invalid PID or overlong field leaves the current filter unchanged and displays a field error. Each text field is limited to 256 Unicode code points.

An unparsed line has unknown structured fields. It remains visible with `ALL` and no tag or PID restriction. It cannot satisfy a restriction that requires missing metadata. Text filtering still works on it.

A filter commit keeps the previous view usable while a replacement index builds. The interface displays **Applying filters**. Only the newest requested filter can become active. The active filter label changes at the same time as its result set.

### Browse and tail semantics

In tail mode, the newest matching event is selected and visible at the bottom. A new nonmatching event does not move the view.

In browse mode, the application anchors the view to event IDs, not array positions. A matching arrival increments **new since pause**. This count means matching arrivals since entering browse mode or committing a new filter. It does not claim those events remain retained or unread. It resets on resuming tail mode or activating a new filter.

If filtering removes the selected event, select the first matching event after it. If none exists, select the last preceding match. Preserve the top event when possible, then make the selected event visible. With no matches, clear the selection and top event but retain browse mode.

If retention evicts an anchor, use the same fallback rule and display **Earlier history expired**. Do not jump into tail mode. A bounded history cannot preserve a row that no longer exists.

Replay completion stops arrivals, not inspection. Device failure behaves the same way, with a failure status instead of **Replay complete**.

## Proposed performance and resource targets

These are initial acceptance budgets, not benchmark claims. Before enforcing timings, record the reference hardware, operating system, Bun version, OpenTUI version, terminal, and dimensions. Keep shared-runner CI timings advisory; enforce structural bounds in every run.

| Measure | Proposed V1 target |
|---|---|
| Retention | At most 100,000 events or 64 MiB of charged history storage, whichever limit is reached first. |
| Input queue | At most 4 MiB of queued source bytes. Stop pulling input at the limit. |
| Single retained line | At most 64 KiB before UTF-8 decoding. Mark and count omitted bytes for longer lines. |
| Steady workload | 10,000 lines per second for 60 seconds, with 256-byte median lines and 1-KiB p95 lines. |
| Burst workload | 50,000 lines delivered over one second, followed by an idle source. Drain within five seconds without application-level input drops. |
| Input responsiveness | Command-to-new-view p95 below 50 ms and p99 below 100 ms during the steady workload. |
| Tail freshness | Receipt-to-visible-model p95 below 100 ms during the steady workload. Measure terminal presentation separately. |
| Filter replacement | p95 below 250 ms over 100,000 retained events, with no planned work slice above 4 ms. |
| Log-row objects | At most the visible row count plus two overscan rows, independent of history size. |
| Render publication | Coalesce data changes to at most 30 updates per second. Navigation can request a frame, subject to a 60-FPS cap. No fixed render loop when idle. |
| Process memory | Initial target: below 256 MiB RSS headless and below 320 MiB with the TUI on the steady workload. Measure native allocations as well as the JS heap. |

The full 100,000-event filter benchmark raises the history-charge cap to 128 MiB so retention does not remove its dataset. Default workload and memory tests keep the 64-MiB cap.

The history charge is an accounting limit, not a claim that it equals process memory. It includes retained text and a fixed event overhead. Actual memory is a separate benchmark.

The application does not silently discard input to maintain frame rate. It first reduces visual updates and stops pulling from a full queue. ADB and Android have their own buffers, so this policy cannot guarantee that the upstream device never loses logs. Do not report unknown upstream loss as zero.

## Device-free development and fixtures

The required fixture set contains synthetic edge cases from the start and at least one reviewed, redacted real capture before the live-source release. No real recording was provided for this specification.

The synthetic set covers split UTF-8, split lines, malformed headers, multiline stack-trace output, control sequences, empty files, clock changes, long lines, filter races, and bursts. Fixed seeds generate large workloads instead of committing huge fixture files.

A real capture records bytes before parsing. A redacted derivative keeps the same recording schema and names its redaction version. Review identifiers, tokens, payment data, personal data, and device metadata before committing it. Label it **sanitized real capture**, not an untouched original.

Recorded timing uses host monotonic receipt offsets. Device timestamps remain log data. Changing playback speed changes timing, not event order or final parsed values.

The proposed command surface is:

```sh
logcayo live --serial DEVICE
logcayo record --serial DEVICE --out sessions/example.lvr.jsonl --duration 60
logcayo replay sessions/example.lvr.jsonl
logcayo replay sessions/example.lvr.jsonl --speed 4
logcayo replay sessions/example.lvr.jsonl --speed instant --headless
```

These commands do not exist yet. `--headless` produces a final JSON summary and view snapshot, without terminal setup. Application tests drive the same session API directly for intermediate assertions.

## Later: natural-language filtering with Jev

Example intent: “Logs related to database access.” The application groups eligible log IDs into bounded batches, obtains one relevance value per ID, and applies a threshold to visibility.

Jev is TypeSafe's model for typed decisions. Its documented Noul question returns a probability-like value for a yes-or-no judgment. [S1], [S2] That primitive is a candidate for the later adapter. The V1 design does not assume a particular latency, provider batch limit, or accuracy on Android logs.

The future feature has these constraints:

- Raw events reach history before classification. Classification never controls ingestion or retention.
- Each result includes a query revision and event ID. An old response cannot affect a newer query or a different session.
- Pending, failed, and skipped classifications remain visible and marked as unclassified by default. Unknown is not equivalent to irrelevant.
- Remote classification requires explicit consent and an approved redaction policy. V1 never sends logs to a model provider.
- Provider limits, false negatives, cost, and end-to-end throughput are evaluated on labeled log recordings before release.

Only the extension contract is specified now. No Jev SDK dependency, remote calls, classifier worker, model configuration UI, or classification cache belongs in V1.

## Non-goals

V1 excludes Rust, a separate engine process, session diffing, pattern clustering, natural-language filtering, regex filters, full-text indexes, multi-device aggregation, package tracking, automatic reconnect, inline expansion, detail panes, and elaborate semantic highlighting.

Basic level styling is included. The earlier Tailspin-inspired visual direction remains a later design opportunity, not a dependency for the first usable release.

## Release gates

The headless engine passes replay, filtering, navigation, eviction, cancellation, and bounded-memory tests before TUI integration starts. The replay TUI then passes a small renderer suite for key translation, resize, visible text, and cleanup.

The live-source release also requires a real redacted fixture, ADB failure contracts, a manual device smoke test, and recorded performance results. Routine development and CI still require no phone.

The release does not claim that terminal rendering is tested without a renderer. It claims that all application behavior is testable without one, with a separate adapter suite for the terminal boundary.

## Sources

External facts are limited to the provider descriptions above. Other statements define proposed product behavior.

[S1]: https://docs.typesafe.ai/introduction "TypeSafe introduction, checked 18 September 2026"
[S2]: https://docs.typesafe.ai/primitives/noul "TypeSafe Noul primitive, checked 18 September 2026"
