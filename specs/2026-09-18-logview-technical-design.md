# Logview V1 technical design

Date: 18 September 2026  
Status: Proposed architecture handoff. Design only.  
Product requirements: [Logview V1 PRD](2026-09-18-logview-prd.md).  
Scope: A headless Android log engine, recording and replay, and a thin OpenTUI adapter.

## Summary

Build a log viewer whose behavior can be tested before a terminal interface exists. Live capture and replay enter the same byte-processing pipeline. Navigation and filtering produce plain view data. OpenTUI renders that data but does not own the session.

The critical contracts are source bytes, parsed events, bounded history, a visible-event index, navigation state, and a portable view snapshot. A later classifier consumes stored events and returns relevance values by event ID.

The PRD owns product behavior and acceptance budgets. This document owns module boundaries, types, call stacks, failure semantics, and vertical implementation slices. All commands and file paths are proposed; they do not describe existing code.

## Current State

The conversation establishes Bun and TypeScript as the initial direction, with OpenTUI for terminal presentation. It also establishes device-free replay, stable browsing, a functional core, and a later Jev integration.

No implementation repository, project instructions, source files, tests, lockfile, or real log recording was supplied. No existing application flow was inspected. This design is not a proposed patch to an assumed repository.

The following external capabilities were checked on 18 September 2026:

| Dependency | Verified fact | Design consequence |
|---|---|---|
| OpenTUI | Its native Zig core has TypeScript bindings and changed-cell rendering. [S1] | Keep terminal drawing in the adapter. Do not infer end-to-end throughput from renderer implementation language. |
| OpenTUI ScrollBox | Viewport culling skips offscreen child render calls. [S2] | Do not confuse culling with avoiding allocation of 100,000 child objects. The application supplies only a visible window. |
| OpenTUI renderer | Demand-driven rendering and frame controls are documented. [S3] | Publish data changes in batches and avoid a continuous idle loop. |
| OpenTUI testing | In-memory renderer tests are available, alongside guidance to test pure logic separately. [S4] | Keep headless tests independent and add a small real-renderer adapter suite. |
| Android Logcat | `threadtime` exposes timestamp, priority, tag, PID, and TID. `epoch` and `usec` are format modifiers. [S5] | Specify one capture profile instead of guessing arbitrary input formats. |
| TypeSafe Jev | Typed questions include Noul, which returns a value between zero and one for a yes-or-no judgment. [S6], [S7] | Reserve a per-event relevance port. Do not treat general provider claims as log-workload benchmarks. |

## Goals

V1 implements PRD P1–P11. In particular, it makes source substitution a normal product capability rather than a test-only workaround.

A developer can replay a fixture, commit filters, navigate, resume tailing, trigger eviction, and observe failures through the same `Session` API used by the TUI. Core and engine tests do not import OpenTUI.

The interface remains responsive while logs arrive. Resource limits and overload behavior are explicit. Tests detect broken behavior rather than merely verifying internal method calls.

## Non-Goals

Do not implement Jev integration, Rust, an engine worker, IPC, generic plugins, session diffing, pattern clustering, package-to-PID tracking, automatic reconnect, arbitrary Logcat format detection, multiline-event reconstruction, regex search, or variable-height rows in V1.

Do not implement a mock copy of the parser, history, navigation engine, or filter engine. Tests use production logic and replace only external effects.

## Invariants and Constraints

| Invariant | Enforcement |
|---|---|
| Event order follows source arrival, not device time. | Assign increasing session-local event IDs after framing. Never sort live history by timestamp. |
| Event identity is `(sessionId, eventId)`. | IDs are never reused within a session. Every later classifier response includes the session ID. |
| Filtering never deletes retained events. | History and the visible index have separate ownership and storage. |
| Browsing does not stop ingestion. | Navigation changes view state only. |
| Existing anchors survive arrivals while eligible and retained. | Store top and selected event IDs, then resolve ranks against the current index. |
| A core function cannot read a clock, process, file, network, terminal, or mutable global. | Pass values in and return values or plans. Enforce import boundaries. |
| Large buffers do not live in immutable reducer state. | The shell owns bounded mutable storage. Reducers receive small value snapshots, not live store handles. |
| No public snapshot aliases mutable arrays. | Return copied, readonly visible rows and scalar counters. |
| Session commits have one writer. | The session processes mutations on one JS thread. No `await` inside an index, history, and navigation commit. |
| Resource bounds apply outside history too. | Bound source packets, byte queues, framer carry, indexes, recording lines, and later classifier work. |
| Stale work cannot replace newer state. | Filter jobs carry a monotonically increasing revision. Validate it at publication. |
| Source completion does not destroy the view. | Keep history until explicit session shutdown. |
| Data is not executable. | Render escaped text, spawn ADB with an argument vector, and keep log text out of commands. |

Event IDs and microsecond epoch values are validated safe integers. Stop with a typed failure rather than wrapping an exhausted ID counter.

## Alternatives

### A. TUI-owned state and source callbacks

```ts
type UiOwnedState = {
	logs: readonly LogEvent[];
	selectedIndex: number;
	filter: FilterSpec;
};

interface UiOwnedController {
	onSourceBytes(bytes: Uint8Array): void;
	onKey(key: string): void;
}
```

Flow: ADB callback → component state → filter array → renderable tree.

The TUI owns history, selection, source cancellation, and filter work. Disk recording would run beside component callbacks. State changes are atomic only to the extent the framework schedules them that way.

This has the smallest initial setup, but UI lifecycle and application lifecycle become the same boundary. Tests either load the renderer or duplicate the state machine. Array-index selection also needs repair after eviction. It does not meet the headless-first requirement.

### B. In-process headless session with pure decision functions

```ts
interface Session {
	start(): Result<void, StartError>;
	dispatch(command: SessionCommand): Result<void, CommandError>;
	snapshot(): SessionSnapshot;
	subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
	readonly sourceDone: Promise<SourceTerminal>;
	stop(): Promise<void>;
}
```

Flow: source adapter → session pump → pure framing and parsing → bounded stores → pure navigation and projection → snapshot subscriber.

The shell owns source handles, time, buffers, and cancellation. The core owns interpretation and decisions. Recording has its own source-to-file command and shares the source and recording contracts. In-memory commits have one writer; file finalization is a separate operation.

Tests use the real session and stores with a scripted source and manual scheduler. Native terminal dependencies stay outside the import graph. CPU-heavy work still shares the main thread, so bounded work slices and measurement are necessary.

### C. Headless engine in a worker or separate process

```ts
type EngineRequest = {
	requestId: number;
	command: SessionCommand;
};

type EngineReply =
	| { kind: "snapshot"; revision: number; value: SessionSnapshot }
	| { kind: "failure"; requestId: number; error: CommandError };
```

Flow: source in engine worker → engine → serialized snapshot → UI process. Commands travel in the opposite direction.

The engine owns history and recordings. UI cancellation becomes a protocol command, followed by worker termination if graceful shutdown fails. Every request needs ordering and failure semantics. A worker crash can remove retained history unless a recording exists.

This isolates CPU work and allows a later Rust engine, but adds serialization, protocol versioning, packaging, and cross-runtime tests. It does not remove the need for a pure core or bounded storage. Use it only after profiling shows that bounded in-process work is insufficient.

### Comparison

| Dimension | A: UI-owned | B: Headless, in-process | C: Worker or process |
|---|---|---|---|
| Application test seam | Component lifecycle | `Session` and pure functions | Session plus transport protocol |
| Cancellation owner | UI | Session shell | Engine plus transport supervisor |
| History transaction | Framework-dependent updates | One synchronous session commit | One engine commit plus snapshot delivery |
| Recording boundary | UI-adjacent callbacks | Independent recorder command | Engine-owned recorder |
| Runtime hops | One | One | At least two |
| Main risk | UI coupling | Event-loop starvation | Protocol and operational complexity |

## Recommendation

Choose B: Bun, TypeScript, and a headless in-process session. Use OpenTUI Core for the first adapter. A later Solid adapter can consume the same snapshots without changing the engine.

Use a functional core with an imperative shell, not a giant immutable array reducer. Pure functions decide parsing, predicates, navigation, filter validation, and presentation. The shell owns a bounded mutable ring buffer and indexes as storage mechanisms.

This distinction prevents a false trade-off between testability and performance. Copying 100,000 records for every incoming batch is not required for a functional core. Storage can enforce a configured capacity. It must not decide filter membership, selection fallback, or when browsing returns to tail mode; those policies belong to the core.

```text
                       imperative shell
  ADB source ─────┐
  replay source ──┼── bounded input ── frame + parse ── history
  scripted source ┘                         │              │
                                      functional core     │
                                                         ▼
                          local predicate ── visible index
                                                         │
  commands ───────────── navigation plan ──────────────────┤
                                                         ▼
                                   portable view snapshot
                                          │         │
                                   headless tests   OpenTUI adapter
```

History stores every admitted event until normal retention eviction. The visible index stores only event IDs. OpenTUI receives only the rows needed for the current window.

## Domain Model and Types

The following TypeScript is a boundary specification, not implementation code. Definitions belong in the files named later in this document.

### Values and parsed events

```ts
type Result<T, E> =
	| { ok: true; value: T }
	| { ok: false; error: E };

type SessionId = string;
type EventId = number; // Positive safe integer, local to one session.
type FilterRevision = number;
type LogLevel = "V" | "D" | "I" | "W" | "E" | "F";
type TextSlice = Readonly<{ start: number; end: number }>;

type LogMetadata = Readonly<{
	epochMicros: number;
	pid: number;
	tid: number;
	level: LogLevel;
	tag: TextSlice;
	message: TextSlice;
}>;

type LogEvent = Readonly<{
	id: EventId;
	sourceOffsetMs: number;
	rawText: string;
	metadata: LogMetadata | null;
	endedWithLf: boolean;
	omittedBytes: number;
	invalidUtf8: boolean;
	chargeBytes: number;
}>;

type FilterSpec = Readonly<{
	minLevel: LogLevel | null;
	tag: string | null;
	pid: number | null;
	text: string;
}>;

type PreparedFilter = Readonly<{
	spec: FilterSpec;
	foldedText: string;
}>;

type ViewState = Readonly<{
	mode: "tail" | "browse";
	topId: EventId | null;
	selectedId: EventId | null;
	newSincePause: number;
}>;
```

`TextSlice` offsets use JavaScript UTF-16 indexing into `rawText`. They do not represent terminal columns. The parser does not retain a second complete copy of the message. Temporary substrings are allowed for filtering and projection.

`sourceOffsetMs` is the source's logical receipt offset. A complete line uses the offset of its newline-bearing packet. An unterminated final line uses the last stdout packet that contributed bytes to it. Replay preserves the recorded value even when playback speed changes. Runtime latency measurements use the scheduler separately.

Initial history charging is `192 + 2 * rawText.length` bytes per event. The fixed charge is a provisional overhead estimate, not an actual allocator measurement. The PRD's RSS gate catches underestimation.

### Source and lifecycle values

```ts
type SourceError = Readonly<{
	kind:
		| "adb-missing" | "no-device" | "ambiguous-device"
		| "unauthorized" | "device-offline" | "unsupported-format"
		| "process-exit" | "recording-invalid" | "io";
	message: string;
	exitCode?: number;
}>;

type SourcePacket = Readonly<{
	kind: "chunk";
	packetSeq: number;
	offsetMs: number;
	stream: "stdout" | "stderr";
	bytes: Uint8Array;
}>;

type SourceTerminal =
	| { kind: "ended"; reason: "eof" | "stopped" }
	| { kind: "failed"; error: SourceError };

type SourceNotice = Readonly<{
	kind: "notice";
	code: "diagnostic" | "partial-recording" | "capture-size-limit";
	message: string;
}>;

type SourceEvent = { kind: "ready" } | SourcePacket | SourceNotice | SourceTerminal;

type SourceStatus =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "running" }
	| SourceTerminal;
```

A source emits `ready` after its setup succeeds, then zero or more packets or notices. It emits exactly one terminal event, then finishes iteration. Setup failure can emit a failure without `ready`. Known external failures are values, not uncaught exceptions. The adapter translates process, file, and cancellation errors. An unexpected programming error fails the session and still runs cleanup.

Packets are at most 64 KiB. Their byte arrays remain unchanged after delivery. Packet sequence numbers cover both stdout and stderr. Ties in receipt time use packet sequence order.

### Commands and snapshots

```ts
type SessionCommand =
	| { kind: "move"; delta: -1 | 1 }
	| { kind: "page"; delta: -1 | 1 }
	| { kind: "oldest" }
	| { kind: "tail" }
	| { kind: "set-filter"; filter: FilterSpec }
	| { kind: "resize"; columns: number; rows: number };

type StartError = { kind: "already-started" | "stopped" };
type ConfigurationError = Readonly<{
	kind: "invalid-options";
	field: string;
	message: string;
}>;

type CommandError = Readonly<{
	kind: "invalid-filter" | "invalid-size" | "stopped";
	field?: "minLevel" | "tag" | "pid" | "text";
	message: string;
}>;

type RowSpan = Readonly<{
	text: string;
	role: "timestamp" | "level" | "tag" | "message" | "warning";
}>;

type ViewRow = Readonly<{
	id: EventId;
	selected: boolean;
	level: LogLevel | null;
	spans: readonly RowSpan[];
	clipped: boolean;
}>;

type SessionStats = Readonly<{
	receivedBytes: number;
	admittedEvents: number;
	retainedEvents: number;
	matchedEvents: number;
	evictedEvents: number;
	unparsedEvents: number;
	truncatedEvents: number;
	omittedBytes: number;
	queuedBytes: number;
	chargedHistoryBytes: number;
	lagging: boolean;
	upstreamLoss: "unknown";
}>;

type SessionSnapshot = Readonly<{
	sessionId: SessionId;
	revision: number;
	source: SourceStatus;
	sourceNotices: readonly SourceNotice[];
	activeFilter: FilterSpec;
	activeFilterRevision: FilterRevision;
	pendingFilter: FilterSpec | null;
	view: ViewState;
	rows: readonly ViewRow[];
	stats: SessionStats;
	notice: "history-expired" | "applying-filter" | "resize-required" | null;
}>;
```

Counters are cumulative except retained count, matched count, queue bytes, history charge, and lagging state. `matchedEvents` counts current retained matches, not all historic matches. Logcat separator lines and blank lines are control input, not admitted events.

### Pure core function contracts

```ts
type FramerState = Readonly<{
	parts: readonly Uint8Array[];
	retainedBytes: number;
	omittedBytes: number;
}>;

type FramedLine = Readonly<{
	bytes: Uint8Array;
	endedWithLf: boolean;
	omittedBytes: number;
}>;

type FrameStep = Readonly<{
	state: FramerState;
	consumedBytes: number;
	lines: readonly FramedLine[];
}>;

declare function frameBytes(
	state: FramerState,
	bytes: Uint8Array,
	options: { eof: boolean; maxLineBytes: number; maxLines: number },
): FrameStep;

type ParsedLine =
	| { kind: "control"; control: "blank" | "buffer-marker" }
	| {
		kind: "event";
		rawText: string;
		metadata: LogMetadata | null;
		invalidUtf8: boolean;
	};

declare function parseLogcatLine(line: FramedLine): ParsedLine;
declare function prepareFilter(spec: FilterSpec): Result<PreparedFilter, CommandError>;
declare function matches(event: LogEvent, filter: PreparedFilter): boolean;

type Location = Readonly<{
	exactRank: number | null;
	nextRank: number | null;
	previousRank: number | null;
}>;

type NavigationFacts = Readonly<{
	count: number;
	visibleHeight: number;
	top: Location;
	selected: Location;
	newMatchingArrivals: number;
}>;

type NavigationCause =
	| Extract<SessionCommand, { kind: "move" | "page" | "oldest" | "tail" }>
	| { kind: "arrivals" }
	| { kind: "filter-committed" }
	| { kind: "retention" }
	| { kind: "resize" };

type NavigationPlan = Readonly<{
	mode: "tail" | "browse";
	topRank: number | null;
	selectedRank: number | null;
	newSincePause: number;
}>;

declare function planNavigation(
	state: ViewState,
	cause: NavigationCause,
	facts: NavigationFacts,
): NavigationPlan;

declare function materializeNavigation(
	plan: NavigationPlan,
	ids: { topId: EventId | null; selectedId: EventId | null },
): ViewState;

declare function projectRows(
	events: readonly LogEvent[],
	selectedId: EventId | null,
	columns: number,
): readonly ViewRow[];
```

The shell obtains `Location` values from the current index, calls `planNavigation`, resolves the resulting ranks to IDs, and calls `materializeNavigation`. These steps occur in one synchronous commit. Pure functions never receive a mutable history or index object.

The framer consumes only as much input as fits the current line-output limit. Its caller retains the unconsumed suffix in the bounded queue. EOF flushing continues until the carry is empty. Partial byte fragments use bounded ownership; do not retain a small subarray that pins a much larger source buffer. Bound fragment bookkeeping as well as bytes. Size-tiered immutable fragments can merge adjacent equal-size pieces without copying the whole carry for every one-byte input chunk.

The core also defines `reduceInteraction(state, input)` in `interaction.ts`. Its values are:

```ts
type InteractionState =
	| { focus: "list" }
	| {
		focus: "filters";
		field: "minLevel" | "tag" | "pid" | "text";
		draft: { minLevel: string; tag: string; pid: string; text: string };
		error: CommandError | null;
	};

type InteractionInput =
	| { kind: "key"; key: string; ctrl: boolean; shift: boolean }
	| { kind: "edit-field"; value: string };

type InteractionResult = Readonly<{
	state: InteractionState;
	command: SessionCommand | null;
	quit: boolean;
}>;

declare function reduceInteraction(
	state: InteractionState,
	input: InteractionInput,
	activeFilter: FilterSpec,
): InteractionResult;
```

Editor draft validation, focus changes, shortcut suppression, and Enter or Escape behavior are testable without a terminal. Cursor movement inside a native text input remains a renderer-adapter concern.

## Interfaces and APIs

### Session construction and storage

```ts
type SessionOptions = Readonly<{
	sessionId: SessionId;
	maxEvents: number;
	maxHistoryChargeBytes: number;
	maxQueuedBytes: number;
	maxLineBytes: number;
	workSliceMs: number;
	maxLinesPerSlice: number;
	columns: number;
	rows: number;
	initialFilter: FilterSpec;
}>;

interface LogSource {
	readonly maxBufferedBytes: number;
	open(signal: AbortSignal): AsyncIterable<SourceEvent>;
	close(): Promise<void>;
}

type Cancel = () => void;
interface Scheduler {
	nowMs(): number;
	after(delayMs: number, task: () => void): Cancel;
	yield(): Promise<void>;
}

declare function createSession(
	options: SessionOptions,
	dependencies: { source: LogSource; scheduler: Scheduler },
): Result<Session, ConfigurationError>;
```

Construction validates finite positive limits, safe integer counts, dimensions, and the initial filter. The history charge cap must hold at least one maximum-size retained line plus its event overhead. Configuration failures name the rejected field.

The session reserves the source's declared `maxBufferedBytes` from its total input budget before sizing its own queue. Reject a source whose reservation leaves no room for one maximum-size packet. The source contract bounds its adapter-owned buffers; kernel and runtime stream buffers are measured separately.

`start()` starts consumption and returns immediately. `sourceDone` resolves after terminal-source handling, final queued-byte processing, completion of the newest pending filter, and final snapshot publication. It does not mean that the session has shut down. Filters submitted after source completion still run normally and publish through the subscriber. `stop()` is idempotent and releases source and scheduled-work resources.

`dispatch()` validates and applies a small command synchronously. Filter commands start a revisioned job and return before that job finishes. `snapshot()` always returns a consistent current view. Subscriber publication is coalesced; `sourceDone` forces the final publication without waiting for an idle render timer.

The session owns real stores. There is no dependency-injected imitation of history in behavior tests. Store interfaces remain internal:

```ts
type HistoryBounds = Readonly<{
	firstId: EventId | null;
	lastId: EventId | null;
	count: number;
	chargedBytes: number;
}>;

type AppendOutcome = Readonly<{
	retainedNewIds: readonly EventId[];
	evictedCount: number;
	evictedThrough: EventId | null;
}>;

interface History {
	append(events: readonly LogEvent[]): AppendOutcome;
	get(id: EventId): LogEvent | undefined;
	bounds(): HistoryBounds;
	readAfter(after: EventId | null, through: EventId, limit: number): readonly LogEvent[];
}

interface VisibleIndex {
	readonly size: number;
	append(ids: readonly EventId[]): void;
	pruneBefore(firstRetainedId: EventId | null): void;
	locate(id: EventId | null): Location;
	at(rank: number): EventId | null;
	window(startRank: number, count: number): readonly EventId[];
}
```

History append applies count and charge limits. It returns only surviving newly added IDs. Index append requires increasing IDs. Prefix eviction removes IDs without shifting the full array. `locate(null)` returns null ranks; navigation chooses the correct empty or initial behavior.

Use a ring for history and a ring or segmented numeric sequence for V1 matching IDs. Avoid `Array.shift()` and repeated whole-history spreads. Binary search provides index lookup by event ID. No promise of a particular container library is part of the public API.

### Process and recording ports

```ts
type ProcessSpec = Readonly<{
	file: string;
	args: readonly string[];
	env: Readonly<Record<string, string>>;
}>;

type ProcessExit = Readonly<{ code: number | null; signal: string | null }>;
interface ChildProcessHandle {
	stdout: AsyncIterable<Uint8Array>;
	stderr: AsyncIterable<Uint8Array>;
	exit: Promise<ProcessExit>;
	terminate(graceMs: number): Promise<void>;
}

interface ProcessRunner {
	spawn(spec: ProcessSpec): Result<ChildProcessHandle, SourceError>;
}

type RecordingError = Readonly<{
	kind: "exists" | "permission" | "disk-full" | "invalid" | "incomplete-final-line" | "io";
	message: string;
	line?: number;
}>;

interface RecordingWriter {
	append(packet: SourcePacket): Promise<Result<void, RecordingError>>;
	finalize(end: RecordingEnd): Promise<Result<void, RecordingError>>;
	abort(): Promise<void>;
}

interface RecordingFiles {
	create(
		path: string,
		header: RecordingHeader,
	): Promise<Result<RecordingWriter, RecordingError>>;
	read(
		path: string,
		signal: AbortSignal,
	): AsyncIterable<Result<RecordingRecord, RecordingError>>;
}
```

`RecordingFiles.create` refuses to overwrite a destination. Creation reserves a private partial file. `finalize` writes the footer, flushes, closes, and publishes the final file without replacing an existing destination. A filesystem-specific implementation must preserve that no-clobber behavior.

The process adapter owns concurrent stdout and stderr consumption and joins process exit with stream completion. It does not put stderr into the log parser. Both streams can still enter a raw recording.

### Source factories and recorder entrypoint

```ts
type AdbSourceOptions = Readonly<{
	adbPath: string;
	serial: string | null;
}>;

type ReplayOptions = Readonly<{
	path: string;
	speed: { kind: "timed"; multiplier: number } | { kind: "instant" };
	allowPartial: boolean;
}>;

declare function createAdbSource(
	options: AdbSourceOptions,
	dependencies: { processes: ProcessRunner; scheduler: Scheduler },
): LogSource;

declare function createReplaySource(
	options: ReplayOptions,
	dependencies: { files: RecordingFiles; scheduler: Scheduler },
): Result<LogSource, ConfigurationError>;

type RecordOptions = Readonly<{
	outPath: string;
	durationMs: number | null;
	maxFileBytes: number;
	header: RecordingHeader;
}>;

type RecordOutcome = Readonly<{
	path: string;
	end: RecordingEnd;
}>;

declare function recordSession(
	source: LogSource,
	options: RecordOptions,
	dependencies: { files: RecordingFiles; scheduler: Scheduler },
	signal: AbortSignal,
): Promise<Result<RecordOutcome, RecordingError | SourceError | ConfigurationError>>;
```

Factories validate configuration without opening a terminal. A timed replay multiplier is finite and greater than zero. Sources open at most once, and `close()` is idempotent. The ADB source advertises its fixed bounded merge-buffer reservation. A replay source advertises its decoded-packet reservation.

`recordSession` owns the source for the duration of recording and closes it on every return path. A source-failure recording can finalize successfully while the command still returns its source error. Finalized output availability does not turn a failed capture into a successful source session.

### Versioned recording contract

```ts
type RecordingHeader = Readonly<{
	kind: "header";
	format: "logview-recording";
	version: 1;
	profile: "threadtime-epoch-usec-v1";
	provenance: "raw-capture" | "sanitized-real" | "synthetic";
	redactionVersion: string | null;
}>;

type RecordingChunk = Readonly<{
	kind: "chunk";
	packetSeq: number;
	offsetMs: number;
	stream: "stdout" | "stderr";
	base64: string;
}>;

type RecordingEnd = Readonly<{
	kind: "end";
	chunks: number;
	outcome: "eof" | "user-stop" | "size-limit" | "source-failure";
	error: SourceError | null;
}>;

type RecordingRecord = RecordingHeader | RecordingChunk | RecordingEnd;

declare function decodeRecordingRecord(
	input: unknown,
): Result<RecordingRecord, RecordingError>;

declare function encodeRecordingRecord(record: RecordingRecord): Uint8Array;
```

The file is UTF-8 JSON Lines: one header, zero or more chunks, then one footer. Packet sequence starts at zero and increases by one. Offsets are finite, nonnegative, and nondecreasing. Base64 decoding is strict. Reject unknown versions, malformed data, duplicate headers, duplicate packet IDs, oversized packets, or trailing records after the footer.

A recording line is at most 128 KiB. A decoded packet is at most 64 KiB. Footer chunk counts must match. `recording-schema.ts` also owns a pure stream validator:

```ts
type RecordingSequenceState = Readonly<{
	headerSeen: boolean;
	expectedPacketSeq: number;
	lastOffsetMs: number;
	ended: boolean;
}>;

declare function validateRecordingSequence(
	state: RecordingSequenceState,
	record: RecordingRecord,
): Result<RecordingSequenceState, RecordingError>;
```

Only `source-failure` carries a non-null error. The presence of a footer means the container finalized, not that the upstream Android buffers were lossless.

Use one deterministic record encoder for both byte-size preflight and writes, including the trailing LF.

The recorder defaults to a 256-MiB file limit. Reserve enough space for the footer before admitting a chunk; stop at a packet boundary with `size-limit`. On an I/O failure, leave `.partial` and return an error. Do not silently continue recording.

Replay rejects an unfinalized recording by default. `--allow-partial` permits a valid prefix and ignores only an incomplete final JSON line, with a persistent warning. Malformed complete lines still fail. `RecordingFiles.read` distinguishes an incomplete final JSON line from a malformed complete line. Replay performs streaming validation. A footer inconsistency discovered at the end marks the session failed while preserving already inspected events.

### Terminal attachment and headless output

```ts
type UiError = Readonly<{ kind: "setup-failed"; message: string }>;
interface TerminalAttachment {
	close(): Promise<void>;
}

declare function attachTui(session: Session): Promise<Result<TerminalAttachment, UiError>>;

type HeadlessOutput = Readonly<{
	version: 1;
	kind: "summary";
	terminal: SourceTerminal;
	snapshot: SessionSnapshot;
}>;
```

The CLI owns the session lifetime. The attachment owns renderer resources, input handlers, and subscriptions. Attachment cleanup is idempotent. A failed attachment cleans up partially initialized native resources before returning its error.

The headless CLI emits one `HeadlessOutput` JSON line after `sourceDone`. Diagnostics use stderr. It does not dump an entire retained history into the final snapshot. Test scenarios subscribe or call `snapshot()` for intermediate behavior.

### Future classifier contract: specification only

```ts
type SemanticQuery = Readonly<{
	revision: number;
	text: string;
	threshold: number;
	promptVersion: string;
	redactionVersion: string;
}>;

type ClassifierItem = Readonly<{
	eventId: EventId;
	tag: string | null;
	level: LogLevel | null;
	message: string;
}>;

type ClassifyRequest = Readonly<{
	sessionId: SessionId;
	requestId: string;
	query: SemanticQuery;
	modelId: string;
	items: readonly ClassifierItem[];
}>;

type Relevance =
	| { eventId: EventId; kind: "scored"; relevance: number }
	| { eventId: EventId; kind: "unknown"; reason: "unsupported" | "too-large" };

type ClassifyResponse = Readonly<{
	sessionId: SessionId;
	requestId: string;
	queryRevision: number;
	resolvedModelId: string;
	results: readonly Relevance[];
}>;

type ClassifierError = Readonly<{
	kind: "cancelled" | "timeout" | "rate-limited" | "auth" | "invalid-response" | "unavailable";
	retryAfterMs?: number;
}>;

interface LogClassifier {
	classifyBatch(
		request: ClassifyRequest,
		signal: AbortSignal,
	): Promise<Result<ClassifyResponse, ClassifierError>>;
}
```

A relevance value is finite and lies in `[0, 1]`. A valid response covers each requested event exactly once, by ID, regardless of response order. Unknown IDs, duplicates, missing IDs, or invalid values invalidate the response. The caller leaves the batch unclassified rather than hiding its events.

This contract is not a Jev SDK API. It is the application's later port. It remains in this specification until the semantic-filter milestone; do not create unused V1 runtime modules for it.

## Boundaries and Adapters

| Boundary | Owner | May cross | Must remain private |
|---|---|---|---|
| Source → ingestion | `LogSource` adapter | Ordered bytes, logical offsets, typed lifecycle events | ADB subprocess, file handles, reader tasks |
| Ingestion → core | Engine shell | Bounded byte fragments, parser values, explicit limits | Scheduling, mutable queues |
| Core → stores | Session commit | Events, matching IDs, navigation plans | Business rules inside container operations |
| Stores → core | Session commit | Copied scalar facts and bounded event windows | Live mutable containers and iterators across an `await` |
| Engine → UI | `SessionSnapshot` | Immutable rows, roles, state, counters | All retained history, parser state, native objects |
| UI → engine | `SessionCommand` | Validated application intent | OpenTUI renderables and key-event objects |
| Recorder → disk | `RecordingFiles` | Validated versioned records | Paths, file descriptors, rename mechanics |
| Later engine → classifier | `LogClassifier` | Explicitly redacted event data and revisioned requests | Full raw history, credentials, mutable session state |

Package direction is `core ← engine ← CLI` and `core ← TUI → engine`. Core has no Bun-specific or OpenTUI imports. Engine adapters can use Bun APIs but do not import the TUI. Only the TUI package depends on `@opentui/core`.

The CLI chooses the mode before loading an adapter. Live and replay with a TUI dynamically load the TUI package. `record`, `--headless`, and all headless tests never load that package, including through an index barrel.

Keep entrypoints separate: `logview/core`, `logview/engine`, and `logview/tui`. Names are provisional local package names, not claims about registry availability.

## Call Stacks and Data Flow

### 1. Live source to retained history

```text
CLI arguments
  → validate source choice and session limits
  → AdbSource selects an authorized device
  → ProcessRunner.spawn(argv)
  → bounded SourcePacket queue
  → frameBytes(partial bytes, next packet)
  → parseLogcatLine(complete or final line)
  → allocate event ID and history charge
  → matches(event, active filter)
  → History.append + VisibleIndex append/prune
  → planNavigation + materializeNavigation
  → mark snapshot dirty
  → publish a bounded visible window
```

The live capture profile uses this argument vector, not a shell command string:

```text
adb -s <serial> logcat
  -b main -b system -b crash
  -v threadtime -v epoch -v usec
  *:V
```

`*:V` is one literal argument. Clear any inherited Logcat formatting or tag-filter environment that could change the profile. Do not enable terminal color output. Capture the available buffer backlog, then follow new output. Do not clear the device's buffers.

The adapter checks device enumeration and authorization. An explicit serial must be present and usable. With no serial, exactly one usable device is required. An unsupported capture profile fails with an explanation rather than silently falling back to a different parser.

A synthetic line illustrates the profile:

```text
1760000000.123456  1234  1250 I Database: BEGIN TRANSACTION
```

The parser reads epoch seconds plus exactly six fractional digits, numeric PID and TID, a supported level, and the tag-message delimiter. Convert epoch time with integer arithmetic and validate the safe-integer range. Keep `rawText` unchanged apart from removing the physical line ending.

V1 defines one event as one physical output line. Preserve unmatched continuation lines as unparsed events. Do not invent PID, timestamp, or tag metadata for them. Blank lines and recognized buffer markers are control input. Text formats can be ambiguous, so original Android record boundaries are not promised; binary Logcat support would require a separate future profile.

The framer handles line boundaries before decoding UTF-8. Split multibyte characters therefore do not corrupt otherwise valid text. Invalid UTF-8 becomes replacement text with an explicit flag. For a line above 64 KiB, retain its prefix, count omitted bytes, and discard until the next newline. The raw recorder does not apply this viewer truncation.

Source timestamps can go backward, repeat, or differ from host time. None of these conditions reorders events or controls replay timing.

### 2. Scheduling, storage, and overload

Source reading and screen publication are separate schedules. A data slice handles at most 256 lines or 4 ms of work, whichever comes first. It also bounds temporary decoded input to 512 KiB per slice. It checks time between bounded units, then yields to the event loop. A 4-ms budget is a target, not preemption of a single JavaScript operation.

Do not await a timer for each line. Also do not treat an `async` function as CPU parallelism. Framing, filtering, and projection remain synchronous work until explicitly yielded or moved to a worker.

The reader requests another packet only when the input budget can hold one full maximum-size packet. The 4-MiB budget includes adapter-owned userland merge buffers, not only the final engine queue; reserve space for the bounded outstanding stdout and stderr reads. A full queue stops pulls. Source adapters must not hide an unbounded emitter queue behind `AsyncIterable`. Drain stdout and stderr concurrently through bounded streams so a full stderr pipe cannot deadlock ADB.

In a commit, process all admitted events for cumulative counters. Append only surviving new IDs to the active index after history eviction. Prune both active and pending indexes before resolving navigation. This handles a batch larger than a tiny test history without leaving dangling visible IDs.

The application never drops received packets merely to hit an FPS target. Retention eviction and explicit long-line truncation are different operations with different counters. When input accumulates, show **Catching up** and reduce publication work before considering more complex runtime topology.

Store logical lag as queue occupancy and the age of the oldest locally queued packet. Do not derive ingestion lag from the device's wall clock. Drain time and queue lag require separate measurements during replay acceleration.

Projection runs only for a requested or published snapshot. It does not map the entire history into row objects. During data-only activity, coalesce publication to 30 Hz. A navigation command requests the next available frame, with a 60-FPS renderer cap. When no state changes, leave the renderer idle. [S3]

The OpenTUI adapter keeps a pool of visible rows plus two overscan rows. Use a fixed viewport with explicit row reuse rather than creating a renderable for every event. Disable widget-owned sticky scrolling; `ViewState` is the sole authority for tail mode. A positional indicator can use total matches and top rank without a full child tree.

### 3. Stable keyboard navigation

```text
OpenTUI key event or headless InteractionInput
  → normalize key representation
  → reduceInteraction(editor state, input, active filter)
  → Session.dispatch(SessionCommand)
  → read index ranks into NavigationFacts
  → planNavigation(current state, cause, facts)
  → resolve top and selected ranks against the same index
  → materializeNavigation
  → project visible events
```

Navigation applies the PRD's key bindings. A page step is `max(1, visibleHeight - 1)`. Clamp selection to the available range. Scroll only enough to keep selection visible. `Home` selects the first match in browse mode. `G` and `End` select the last match in tail mode.

For arrivals in browse mode, preserve both anchor IDs when possible. Resolve an unavailable anchor to the next matching ID, then the previous matching ID if no later match exists. Selection takes priority over preserving the top row when both cannot fit. If an empty browse view receives its first match, select the first match without enabling tail mode.

When resize reduces the viewport, retain selected identity and adjust the top anchor minimally. A resize-required state keeps source consumption active. Terminal character-width calculation belongs to pure presentation code with explicit Unicode-width fixtures. No truncation routine may split an escape representation or output a terminal control byte.

### 4. Filter replacement while logs continue

```text
committed FilterSpec
  → prepareFilter and validate
  → increment requested revision
  → cancel prior pending scan
  → capture first ID and high-water event ID
  → scan retained events through that high-water ID in bounded slices
  → evaluate later arrivals into a separate candidate tail
  → validate requested revision and current retention boundary
  → join candidate prefix and candidate tail
  → atomically replace active index and active filter
  → reconcile navigation by ID
```

The old active filter remains usable until the new index is ready. Newly ingested events are evaluated against both the active filter and the newest pending filter. A candidate scan skips events evicted before it reaches them.

Keep the scanned prefix and post-high-water tail separate so late arrivals cannot make the candidate out of order. Use segmented storage that can join those sequences without a whole-history copy on the final commit. Prune candidates below the current retained boundary before publication.

At most one active index and one candidate index exist. A cancelled scan releases its segments and scheduled callbacks. A later continuation verifies its revision before doing work and before publishing. Replacing filter A with B cannot leave A's label with B's rows or resurrect evicted IDs.

Filter activation resets **new since pause**. Arrivals after activation count under the new filter. A changed filter never switches browse mode to tail mode.

### 5. Record a session without a TUI

```text
record command
  → validate output and limits
  → RecordingFiles.create(header, private partial file)
  → AdbSource packets
  → RecordingWriter.append(packet), with awaited backpressure
  → duration limit, user stop, source end, or file-size limit
  → stop and join source
  → finalize footer and publish file
```

The recorder stores source bytes, not `LogEvent` objects. Base64 preserves chunk bytes that would otherwise be changed by text decoding. Output timing is relative to a monotonic host clock sampled at packet receipt. Do not store ambient credentials or device serials in the header.

This command does not construct `Session`, load OpenTUI, or apply view filters. Its fidelity boundary is bytes delivered by the source adapter. It cannot recreate messages lost upstream before ADB delivered them.

On a user stop, stop the producer, drain bounded bytes already delivered, and finalize with `user-stop`. On source failure, finalize with `source-failure` when the writer still works. On disk failure, preserve the partial file and return a nonzero exit status.

### 6. Replay through the production pipeline

```text
replay command
  → RecordingFiles.read and schema validation
  → ReplaySource decodes SourcePacket bytes
  → schedule packet delivery from recorded offsets
  → same Session ingestion, framing, and parsing path as ADB
  → same history, filters, navigation, and snapshot API
```

For playback speed `s`, the due time is `playbackStart + recordedOffset / s`. Preserve packet order when due times are equal. If processing falls behind, deliver overdue packets in order without accumulating extra timing delays.

Immediate replay removes timing waits but respects queue bounds and scheduler yields. EOF flushes framer carry once, processes all queued packets, and publishes the final view. The application remains open for inspection unless `--headless` was selected.

A `size-limit` footer produces a persistent `capture-size-limit` notice. A source-failure footer reproduces a failed source state. An accepted partial prefix produces a persistent `partial-recording` notice. Ordinary finalized recordings complete with EOF, including recordings intentionally ended by the user.

The source's recorded offsets remain unchanged in events. Original timing, accelerated timing, and immediate replay must have the same final event IDs, decoded content, metadata, and filter results. Intermediate snapshots may differ because publication timing differs.

### 7. Shutdown, failures, and cleanup

```text
q, Ctrl+C, or session.stop()
  → mark stopping and abort source work
  → cancel filter and publication callbacks
  → terminate child process or close replay reader
  → join bounded in-flight work
  → resolve source completion if unresolved
  → unsubscribe UI
  → destroy renderer in finally
```

`stop()` is safe after partial initialization and safe when called twice. Viewer shutdown may abandon queued, unprocessed bytes because inspection has ended; it is not a lossless recording operation. The recorder has its separate drain-and-finalize contract. Preserve an already observed source failure instead of overwriting it with a stopped status. The ADB adapter gives its child a one-second termination grace period, then forces child termination if necessary. It does not kill the shared ADB server.

Do not automatically reconnect or retry live capture in V1. A disconnected source leaves a readable failure state and retained history. Retrying is an explicit new invocation, with a new session ID. This avoids unstated rules for duplicate backlog and reconnect ordering.

The CLI returns exit code 2 for invalid arguments, 1 for a source or recording failure, and 0 for normal replay completion or a normal user stop. With a TUI, defer process exit until the user quits after a source failure. A source failure remains an exit failure even if retained rows were inspected successfully. A size-limit recording is a valid, deliberately bounded capture and exits normally with a visible limit notice. The duration option is in seconds.

Diagnostics are bounded and separate from log data. Keep at most 16 source notices with 2-KiB messages, deduplicated by code. Never write raw child stderr into the active terminal screen.

### 8. Later Jev classification

```text
history commit
  → select retained IDs eligible under local filters
  → queue a bounded set for the active semantic query
  → redact fields under an explicit consent policy
  → LogClassifier.classifyBatch(request, signal)
  → validate response shape, IDs, model, session, and query revision
  → store relevance annotations separately from LogEvent
  → update visible membership in original event order
  → reconcile browse anchors and publish a snapshot
```

Local filters run first to avoid classifying already excluded records. When local filters broaden, previously unclassified retained events become eligible. A new semantic query invalidates earlier work and schedules a bounded backfill of retained eligible events. New arrivals take priority over older backfill.

A later initial policy can batch up to 100 logs, flush after 50 ms, permit two in-flight requests, and hold at most 2,000 queued IDs. Also cap the UTF-8 encoded request at 128 KiB. Split batches that exceed the cap; an individual oversized item becomes `too-large`, not silently truncated. These are proposed application limits, not confirmed Jev API limits. The adapter must also enforce the provider's question, token, and request-size limits.

When the queue is full, leave excess records explicitly unclassified. Do not stall ingestion or create unlimited retries. Pending, failed, and skipped records pass the semantic filter by default and carry an unclassified marker. A scored record is included when `relevance >= threshold`. The raw record remains in history either way.

Do not assume that “100 items per call” meets live throughput. At 100 items, two concurrent calls, and 50-ms end-to-end latency, maximum service capacity is approximately 4,000 items per second before overhead. That is below the V1 ingestion workload of 10,000 lines per second. The semantic feature needs its own capacity test, admission policy, and visible coverage counter.

TypeSafe documents multiple named questions against a shared state and a Noul value per question. [S6], [S7], [S8] One candidate mapping is an ID-keyed state plus one yes-or-no question for each event. Do not use one mutually exclusive Choice across 100 logs when several logs may be relevant. Validate cross-item interference and batch-size limits before selecting the mapping.

Treat log text as untrusted data, not provider instructions. Keep the user intent and event data structurally separate. The model gets no tools or permissions. Use an explicit model version for evaluated releases; a moving alias cannot identify a reproducible cache entry.

Cache keys include session or content identity, query text, prompt version, redaction version, and resolved model version. When scoring uses neighboring logs or shared batch context, include that context in the content hash. Bound caches and annotation tables. Eviction removes event annotations and cancels queued work. Ignore results for evicted IDs, old query revisions, or stopped sessions even if cancellation failed to stop the remote request.

Retries are limited to one retry for a transient failure, within the active query and a configured deadline. Respect provider retry delays. Never retry authentication or schema errors automatically. Request IDs make application result application idempotent; they do not imply provider-side billing idempotency.

V1's append-only visible index may need replacement with an ordered membership index for semantic insertions and removals. That implementation change stays behind the history-to-view boundary. Do not build a generalized membership framework now merely to avoid this later change.

## Files to Add, Change, or Delete

No existing files are changed or deleted because no target repository was supplied. The following is the proposed file map. A future repository's naming and package conventions take precedence after inspection, but the ownership boundaries remain.

### Core files

| New file | Responsibility |
|---|---|
| `packages/core/src/types.ts` | Domain values, `LogEvent`, filters, view values, result and error types. |
| `packages/core/src/commands.ts` | `SessionCommand`, command validation values, navigation causes. |
| `packages/core/src/framing.ts` | `frameBytes`, bounded partial-line state, EOF and truncation behavior. |
| `packages/core/src/logcat.ts` | `parseLogcatLine`, canonical profile grammar, metadata slices. |
| `packages/core/src/filters.ts` | `prepareFilter` and the literal `matches` predicate. |
| `packages/core/src/navigation.ts` | `planNavigation` and `materializeNavigation`. |
| `packages/core/src/interaction.ts` | Pure focus, filter-draft, key-mapping, and editor transitions. |
| `packages/core/src/projection.ts` | `projectRows`, row roles, column allocation, and clipping policy. |
| `packages/core/src/display-text.ts` | Escaped display text and deterministic terminal-column measurement. |
| `packages/core/src/index.ts` | Core-only public exports. No runtime adapters. |

### Engine and adapter files

| New file | Responsibility |
|---|---|
| `packages/engine/src/contracts.ts` | `Session`, `SessionOptions`, and portable snapshots. |
| `packages/engine/src/ports.ts` | Source, scheduler, subprocess, and recording file contracts. |
| `packages/engine/src/session.ts` | Session lifecycle and the single-writer commit boundary. |
| `packages/engine/src/ingest.ts` | Bounded byte queue, parser slices, event IDs, and scheduling. |
| `packages/engine/src/history.ts` | Bounded mutable history and charge accounting. |
| `packages/engine/src/visible-index.ts` | ID sequence, rank lookup, visible windows, and prefix pruning. |
| `packages/engine/src/reindex.ts` | Revisioned filter jobs, high-water scan, candidate tail, and atomic replacement. |
| `packages/engine/src/recording-schema.ts` | Record types, per-record decoding, and stream-order validation. |
| `packages/engine/src/recorder.ts` | `recordSession`, headless recording orchestration, and stop limits. |
| `packages/engine/src/adapters/adb.ts` | `createAdbSource`, device discovery, capture profile, packets, and typed ADB errors. |
| `packages/engine/src/adapters/replay.ts` | `createReplaySource`, playback timing, and partial-file policy. |
| `packages/engine/src/adapters/process.ts` | Bun subprocess handles and bounded stdout/stderr transport. |
| `packages/engine/src/adapters/recording-files.ts` | Streaming JSON Lines I/O, private partial files, and finalization. |
| `packages/engine/src/adapters/scheduler.ts` | Monotonic time, scheduled callbacks, and event-loop yields. |
| `packages/engine/src/index.ts` | Headless engine exports without CLI or TUI imports. |

### CLI, interface, and project files

| New file | Responsibility |
|---|---|
| `packages/cli/src/main.ts` | Argument validation, subcommand selection, and deferred TUI loading. |
| `packages/cli/src/headless.ts` | `HeadlessOutput` and replay or live session without terminal setup. |
| `packages/cli/src/record.ts` | `record` command arguments and recorder lifecycle. |
| `packages/tui/src/app.ts` | `attachTui`, renderer lifecycle, subscription, and normalized input forwarding. |
| `packages/tui/src/log-list.ts` | Fixed row pool and visible-window rendering. |
| `packages/tui/src/filter-form.ts` | Native text-input mechanics around the pure interaction reducer. |
| `package.json`, `bun.lock`, `tsconfig.json` | Pinned workspace tools, scripts, and strict type checks. |
| Each package's `package.json` | Explicit dependency direction and separate exports. |
| `README.md` | Proposed commands, supported capture profile, and headless development workflow. |
| `.gitignore` | Exclude private recordings, partial files, secrets, and generated benchmark datasets. |
| `tests/support/scripted-source.ts` | Controlled source packets and lifecycle events. |
| `tests/support/manual-scheduler.ts` | Deterministic timer and yield control without real sleeps. |
| `tests/support/scenario.ts` | Wire the real session to controlled dependencies and return snapshots. |
| `tests/fixtures/synthetic/` | Small raw packet fixtures with independently reviewed expectations. |
| `tests/fixtures/real/` | Later sanitized real capture and provenance manifest, absent until recorded. |
| `bench/generate.ts` | Fixed-seed workload generation with declared byte-size distribution. |
| `bench/run.ts` | Headless and TUI workload measurement and JSON results. |

Future files, not V1 additions: `packages/engine/src/semantic/contracts.ts`, `semantic/coordinator.ts`, `semantic/annotations.ts`, and `adapters/jev.ts`. They own the later classifier types, bounded scheduling, annotation storage, and provider mapping respectively.

## Red-Green Test Plan

Implement one row at a time. First agree on the public seam and write one failing observable test. Then write the minimum implementation to pass. Expand that slice with its failure case before starting the next row.

| Slice | First failing behavior test | Minimum production path | Next failure or invariant |
|---|---|---|---|
| 1. Bytes to an event | A source line split inside its timestamp and UTF-8 character produces the expected metadata and original decoded text. | Framer and canonical parser. | CRLF, EOF without LF, invalid UTF-8, blank markers, malformed headers, and a line over the cap. |
| 2. Bounded history | Append known events past a tiny capacity and read back the exact surviving IDs. | Real history storage and accounting. | Byte limit before count limit, huge batches, and no stale references. |
| 3. Headless replay | A synthetic recording reaches the same final snapshot as the same source packets delivered directly. | Recording validation, replay source, scheduler, and `Session`. | Invalid version, malformed Base64, wrong footer count, empty recording, and explicit partial mode. |
| 4. Tail behavior | New matching arrivals select the newest event and retain only the visible window in the snapshot. | Active index, tail planning, projection. | Empty source, nonmatching arrivals, and source EOF. |
| 5. Stable browsing | After moving up, append a large batch and observe the same top and selected event IDs. | Browse planner and command seam. | Down to the last row stays in browse; only `G` or `End` enables tail. |
| 6. Retention repair | Evict the top anchor while retaining the selected event and preserve selection without entering tail. | History/index pruning and fallback rules. | Evict both anchors, resize, and empty-to-nonempty browse behavior. |
| 7. Local filters | Commit level, tag, PID, and text restrictions and observe independently specified matching IDs. | Filter validation and incremental indexing. | Invalid PID, literal regex characters, case rules, unparsed lines, and clearing filters. |
| 8. Filter races | Begin filter A, request B before A completes, then append and evict events. Only B becomes active with correct rows. | High-water scan, candidate tail, cancellation, and final commit. | Cancel immediately before swap, EOF during scan, and no matching rows. |
| 9. Pure interaction | `/`, text edit, and `Enter` produce a text-filter command; `Escape` produces none. | Interaction reducer. | `q` is text in an editor, list shortcuts are suppressed, and invalid fields retain the draft. |
| 10. Raw recording | Capture a scripted source to a temporary file, replay it, and observe identical stdout bytes and packet order. | Real recorder and file adapter. | Disk write failure, size limit, existing output, source failure, and interrupted final record. |
| 11. ADB adapter | A tiny test subprocess emits controlled stdout/stderr and exits; the adapter produces the correct packets and terminal status. | Process runner plus injectable device-command results. | Missing executable, multiple devices, unauthorized device, format rejection, stderr flood, and cancellation. |
| 12. Whole headless application | Replay, navigate, filter, evict, finish the source, and stop through the public session API without loading a renderer. | CLI headless route and engine exports. | Double stop, partial initialization failure, no pending callbacks, and import-boundary enforcement. |
| 13. Performance | A fixed-seed source meets the PRD's bounded storage and row-allocation assertions while receiving navigation commands. | Instrumented production path. | Burst drain, repeated filter changes, capped long lines, and a memory plateau over repeated retention cycles. |
| 14. TUI adapter | A real in-memory OpenTUI renderer displays the projected rows and forwards `↑` into the session. | Minimal native adapter and row pool. | Resize, CJK and emoji display, editor focus, setup failure, and terminal cleanup. |

### Test files and seams

| Test path | Public seam |
|---|---|
| `packages/core/test/framing.test.ts`, `logcat.test.ts` | Raw bytes → framed lines → parsed values. |
| `packages/core/test/filters.test.ts`, `navigation.test.ts`, `interaction.test.ts`, `projection.test.ts` | Values → expected predicates, plans, commands, and rows. |
| `packages/engine/test/history.test.ts`, `visible-index.test.ts` | Append, evict, locate, and window results. |
| `packages/engine/test/replay.test.ts`, `recording.test.ts` | Versioned disk format and source parity. |
| `packages/engine/test/session.test.ts`, `reindex.test.ts` | Public session snapshots across actions and arrivals. |
| `packages/engine/test/adb-contract.test.ts` | Real subprocess transport with controlled test executables. |
| `packages/cli/test/headless.test.ts` | Exit status, JSON summary, and no terminal initialization. |
| `tests/architecture/import-boundaries.test.ts` | Core and headless dependency graph excludes TUI and native renderer imports. |
| `packages/tui/test/app.test.ts` | Native in-memory frames, keys, resize, and destruction. |

The repeated short names in the table are relative to the first directory named in the same cell.

### Concrete headless acceptance scenario

Use five visible rows and a history limit of eight events. A fixture contains independently labeled matches; expected IDs are handwritten rather than obtained by running the production filter.

```text
Deliver events 1–8, all matching.
Expect tail mode, rows 4–8, selection 8.

Move up twice.
Expect browse mode, top 4, selection 6.

Deliver events 9–10, both matching.
Expect retained IDs 3–10, rows 4–8, selection 6,
  browse mode, and newSincePause = 2.

Deliver events 11–14, all matching.
Expect retained IDs 7–14, rows 7–11, selection 7,
  browse mode, and a history-expired notice.

Commit a text filter whose independently specified matches are 8, 10, and 14.
Expect rows 8, 10, 14, selection 8, browse mode,
  and newSincePause = 0.

Dispatch tail.
Expect selection 14 and tail mode.
```

Test the first stage before implementing the next stage. This scenario proves visible behavior without a phone, a terminal, or a pre-parsed replay shortcut.

### Avoid tautological tests

Assert retained IDs, parsed fields, final snapshots, emitted bytes, error values, and resource bounds. Do not treat “the parser mock was called” or “the filter mock returned these values” as correctness evidence.

Generate no expected fixture values with the parser under test. For selected cases, mutate a delimiter, level comparison, revision check, or tail transition and confirm that the relevant test fails. Contract fakes need their own tests so they do not redefine the source protocol accidentally.

Property tests cover arbitrary chunk boundaries, repeated timestamps, and repeated append/evict cycles. Same bytes in a different chunking must produce the same parsed content and order. Receipt offsets may differ when the source deliberately changes packet timing, so that property does not assert identical timing metadata.

### Later semantic-filter test slices

These slices begin after V1, not alongside it. They add the future contracts to source code only when used.

| Slice | First failing behavior | Production increment |
|---|---|---|
| Batch decisions | A fake classifier rates 100 known IDs in shuffled response order; matching rows stay in source order and history retains all 100. | Classification coordinator and ID-keyed annotations. |
| Query replacement | Query B replaces A while A's response is pending. A's late results change neither B's view nor its counters. | Revision guards, cancellation, and idempotent result application. |
| Incomplete service | A full queue, timeout, invalid response, or oversized item leaves the affected rows visibly unclassified without stopping ingestion. | Admission bounds, response validation, and failure policy. |
| Provider boundary | Recorded, redacted provider responses map to the port without leaking provider types into the core. Disabled remote consent results in zero outbound calls. | Jev adapter and explicit egress control. |
| Evaluation | Session-separated labeled logs establish recall, precision, coverage, capacity, and cost against agreed release thresholds. | Optional credentialed evaluation job, never a dependency of deterministic CI. |

The fake classifier uses controlled promises, not real sleeps. Tests can resolve requests in any order, after eviction, or after shutdown. Live provider responses are evidence for an evaluation, not stable expected values for unit tests.

### Test commands and benchmark evidence

Define these scripts during implementation:

```sh
bun run test:headless
bun run test:adapters
bun run test:tui
bun run bench:headless
bun run bench:tui
```

`test:headless` includes core, store, session, replay, interaction, CLI, and architecture tests. It does not build the TUI, load OpenTUI, start ADB, contact a provider, or sleep on wall-clock timers. `test:adapters` can launch local fixture executables and use temporary files, still without a phone.

OpenTUI's in-memory test renderer is the later UI seam, not the prerequisite for engine tests. [S4] Manual testing on a real terminal and a device remains a release check for the external boundaries.

Each benchmark record includes the source seed, byte-size distribution, record count, hardware, OS, runtime and dependency versions, terminal dimensions, CPU use, RSS, heap size, queue maxima, work-slice duration, input latency, and filter completion times. Do not report a single average FPS as proof of responsiveness.

The full 100,000-event filter benchmark uses a 128-MiB history-charge cap so larger lines do not evict the dataset early. That override is recorded in its results. Default workload and memory gates retain the 64-MiB cap.

For a memory plateau test, run through at least ten full history-eviction cycles. Compare steady-state memory windows rather than expecting each garbage-collection sample to match. Structural limits remain hard assertions; reference-machine timing budgets are a separate gate.

## Risks and Open Questions

| Risk or open decision | Current position | Resolution or release gate |
|---|---|---|
| Product name and repository | `logview` and all paths are provisional. No repository was inspected. | Inspect the chosen repository and its instructions before writing application files. |
| Functional-core interpretation | Mutable storage is confined to the shell; decisions remain pure. | Import checks and tests reject live store access from reducers. |
| Text Logcat fidelity | V1 preserves output lines, not original binary record boundaries. | Document the capture profile and compare it with a real device fixture. |
| Real recording availability | None was supplied or captured for this handoff. | Add a reviewed, sanitized real capture before the live-source release. Synthetic fixtures unblock earlier work. |
| Performance numbers | PRD budgets are proposed and unmeasured. | Record a dedicated reference environment and benchmark before calling them achieved. |
| Source overload | Bounded pulling can still leave upstream buffers under pressure. | Expose lag and unknown upstream loss. No lossless upstream claim. |
| Main-thread blocking | Native rendering does not accelerate JS parsing or filter scans. | Profile slices. Consider a worker only after bounded in-process work fails the responsiveness target. |
| Memory accounting | Text charge excludes exact JS/native allocator behavior. | Measure RSS and native memory, not only event count. |
| UI culling assumptions | OpenTUI culling skips drawing; it is not proof of bounded row allocation. [S2] | Assert a fixed row pool independent of retained history. |
| Terminal widths | Unicode graphemes and terminal behavior can differ. | Pin the width policy, test known cases, and run a real-terminal smoke test. |
| Supported platforms | Initial proposal: macOS and Linux. Windows is not a V1 release commitment. | Confirm distribution targets and pin compatible Bun/OpenTUI builds at implementation start. |
| Recording privacy | Raw logs can contain secrets and personal data. | Private local files, ignored capture directories, fixture review, no V1 model egress. |
| Recording publication | Rename behavior and permission guarantees differ by filesystem. | Test no-clobber finalization and private file creation on supported platforms. |
| Jev accuracy and capacity | No latency, cost, recall, or provider batch-limit claim is made here. | Verify current API limits and evaluate a held-out, session-separated log dataset before implementation of the later feature. |
| Semantic coverage | The classifier may not keep up with ingestion. | Show classified versus pending/skipped coverage. Do not silently equate unknown with irrelevant. |
| Later semantic index | Arbitrary membership updates differ from append-only V1 filtering. | Replace index internals behind the existing storage-to-view boundary in that milestone. |

Architecture implementation can start without resolving the public name or later Jev thresholds. Live-source release cannot proceed without the device-boundary checks, fixture review, and measured performance results.

### Source references

External facts are cited where they affect the design. The contracts, limits, and algorithms in this document are proposed application decisions.

[S1]: https://opentui.com/docs/ "OpenTUI introduction, checked 18 September 2026"
[S2]: https://opentui.com/docs/components/scrollbox/ "OpenTUI ScrollBox and viewport culling, checked 18 September 2026"
[S3]: https://opentui.com/docs/core-concepts/renderer/ "OpenTUI renderer scheduling, checked 18 September 2026"
[S4]: https://opentui.com/docs/core-concepts/testing/ "OpenTUI testing, checked 18 September 2026"
[S5]: https://developer.android.com/tools/logcat "Android Logcat formats and modifiers, checked 18 September 2026"
[S6]: https://docs.typesafe.ai/introduction "TypeSafe typed questions, checked 18 September 2026"
[S7]: https://docs.typesafe.ai/primitives/noul "TypeSafe Noul result semantics, checked 18 September 2026"
[S8]: https://docs.typesafe.ai/introduction/quickstart "TypeSafe request and response shape, checked 18 September 2026"
