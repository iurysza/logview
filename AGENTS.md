# logcayo

Keyboard-driven Android log viewer. Functional core in `@logcayo/core`, session engine in `@logcayo/engine`, CLI in `@logcayo/cli`, terminal UI in `@logcayo/tui`.

## Project skills

Copied from [`iurysza/agent-skills`](https://github.com/iurysza/agent-skills) at `75fbca5074af5b94814683f5145e1f3edb454030` into `.agents/skills/`. Attribution is in `.agents/THIRD_PARTY_NOTICES.md`.

Use these for design, implementation, review, and writing in this repo:

- `brainstorming`, `setup-goal`, `goal`, `tech-spec`, `domain-modeling`
- `coding-standards`, `type-breakdown`, `tool-install`
- `create-verification-skill`, `maintain-verification-skill`, `verify-logcayo`
- `better-ui`
- `readback`, `technical-writing`, `deslopify`, `strunk-writing-quality`, `rephrase`, `bro`

## Working rules

- Keep `@logcayo/core` free of Bun, OpenTUI, files, processes, and clocks. Pass values in and return values.
- Drive behavior through the public `Session` API. Headless tests must not start ADB or load OpenTUI.
- Public contracts stay those in `specs/2026-09-18-logcayo-technical-design.md`.
- `bun run check` is the quality path: anti-slop lint, TypeScript, and headless tests.
- For terminal UI changes, run `bun run test:ui` and `bun run ui:verify --scenario NAME --out generated/ui/NAME`. Inspect the saved PNG, text, cells, and metadata before changing a baseline. Only `bun run ui:update --scenario NAME` may write `packages/tui/test/baselines/`.
- UI state tests use the public `Session` API with `ManualScheduler`. UI entrypoint, input, resize, quit, and exit checks use the pinned Terminal Control PTY. Do not add sleeps or inspect historical output to assert a visible screen.
