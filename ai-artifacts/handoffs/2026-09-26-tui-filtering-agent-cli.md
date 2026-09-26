# Handoff: Logview TUI filtering, visual polish and agent CLI

Owner: Iury. Coordinator: you (Opus, Pi, in Herdr). Date: 2026-09-26.

## Where you are

- Worktree: `~/dev/worktrees/logview/tui-filtering-agent-cli`
- Branch: `feature/tui-filtering-agent-cli`, cut from `origin/main` at `ab0768c` (visual revamp merged).
- Main checkout `~/dev/personal/tools/logview` has Iury's uncommitted changes. Do not touch it.
- Read `AGENTS.md`, `README.md`, `specs/` and `packages/{core,engine,cli,tui}` first.

## Goals

1. **TUI review and fixes.** Analyse the visual layer and the filtering UX. Apply well-known TUI patterns where they fit, for example:
   - consistent keymap and a discoverable help overlay or footer hints
   - modal clarity: always show the current mode and active filters
   - incremental filter with instant feedback, clear/undo, filter history
   - focus handling, scroll position kept stable while filtering, follow/tail toggle
   - match highlighting, counts (visible vs total), empty states
   - no flicker, bounded redraws, and respect for terminal size and colour support
   Pick what adds value. Don't gold-plate. Justify each change against the current code.
2. **Headless agent CLI.** Research and design how an agent can use Logview without the TUI, through a CLI that uses the **same core and engine code paths** as the TUI (one filter model, one query language, one parser). No duplicated filter logic. Look at the existing `packages/cli/src/headless.ts` first and extend it; don't build something parallel. Consider:
   - stable machine output (JSON/NDJSON), exit codes, `--help` quality
   - the same filter expressions the TUI accepts, so a filter can move between the TUI and the CLI unchanged
   - one-shot queries over recordings/files and bounded live capture (`--since`, `--limit`, `--timeout`)
   - read-only by default
3. **Architecture.** Functional core and imperative shell. The TUI and the CLI are thin adapters over a shared filter/query module. Make invalid states unrepresentable. Keep the existing architecture tests in `tests/architecture` passing, and extend them to enforce the boundary (for example, the CLI must not import the TUI, and filter logic lives in core only).

## How to work

- **You think, workers type.** Do the design and the hard parts yourself: the shared filter/query contract and the CLI surface. Write a short design note in `ai-artifacts/` before delegating.
- **Workers:** Pi agents in this Herdr workspace. Mostly `cursor/grok-4.7@256k`. Use `openai-codex/gpt-6-sol` for tricky pieces. Start them with `herdr agent start <name> --kind pi --pane <id> -- --model <model>`.
- **All coordination goes through the Herdr API** (`herdr agent prompt/wait/read`, `herdr pane ...`). Read the `herdr` skill first. Give each worker one bounded job with explicit file ownership.
- **One writer per worktree.** Workers that edit in parallel get their own worktrees under `~/dev/worktrees/logview/` (see the `git-worktrees` skill). Otherwise run them one after another in this worktree.
- At most two to three writers at once. Skip parallel review swarms. You review the diffs.
- Verify by driving the real thing. Run `bun run check`, `bun run test:tui:deterministic` and `bun run ui:verify`, then the new CLI against the fixtures in `tests/` and `sessions/`. "Should work" is not a result.
- Oxlint is the linter. Keep it clean.

## Boundaries

- No push, PR, merge or release without Iury's explicit approval. Local commits on the feature branch and worker branches are fine for integration. Use conventional commits authored by Iury, with no agent co-author trailer.
- Don't touch `private-recordings/` content or the main checkout.
- Small, reviewable changes. Say what is a spike and what is finished.

## Done means

- A design note, the implemented TUI changes, and the agent CLI sharing core filter logic with the TUI.
- Updated `README.md` usage for the CLI, and tests that cover the shared filter contract from both adapters.
- A final report in `ai-artifacts/`: what changed, what was verified and how, open questions, and follow-ups.
