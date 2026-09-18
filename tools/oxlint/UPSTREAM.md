# anti-slop provenance

Source repository: https://github.com/dmmulroy/anti-slop  
Upstream commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`  
Copied from: `src/` → `tools/oxlint/anti-slop/`  
Copied on: 18 September 2026  

This project vendors anti-slop as documented by that repository: there is no official npm package. The plugin is local source registered through Oxlint `jsPlugins`.

Installed companion packages (exact versions, kept in lockstep):

- `oxlint@1.83.0`
- `@oxlint/plugins@1.83.0`

Intentional deviations from the copied snapshot:

- Plugin RuleTester files (`*.test.ts`) were not copied. They are not required to load or run the rules.
- LICENSE from the upstream repository is retained beside the plugin entry.
- Nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` are preserved.

No rule source was edited after copy.
