# Contributing to unison-mastra

Thanks for helping improve the Mastra agent memory integration for Unison.

## Repo layout

A single-package TypeScript project built with tsup:

- `src/index.ts` — package entry point and exports
- `src/memory.ts` — `UnisonMastraMemory` (`MastraMemory` subclass)
- `src/client.ts` — `UnisonClient` low-level HTTP client
- `src/types.ts` — shared TypeScript types

## Development

```bash
npm install
npm run build       # compile to dist/
npm test            # run all tests with vitest
npm run typecheck   # TypeScript type-check (alias for tsc --noEmit)
```

## Before opening a PR

1. `npm run build` and `npm test` must both pass.
2. Keep changes scoped — one logical change per PR.
3. Add or update a test for every new behavior.
4. Do not commit `.env` or any real credentials.

## Conventions

- TypeScript, ESM + CJS dual output (tsup bundles both).
- `@mastra/core` is the only peer dependency — keep the install footprint minimal.
- If the brain is unreachable or the token is missing, fail gracefully — never crash the Mastra agent.
- The client enforces nothing — the Unison backend is the only security boundary. Do not add client-side scope or path checks.

## Reporting bugs / proposing features

Use the issue templates. For security issues, see [`SECURITY.md`](./SECURITY.md) — do **not** open a public issue.
