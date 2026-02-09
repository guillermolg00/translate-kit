# Copilot instructions for translate-kit

## Build, test, typecheck
- Build: `npm run build`
- Build (watch): `npm run dev`
- Test all: `npm test`
- Test single file: `npm test -- tests/flatten.test.ts` (Vitest CLI args)
- Typecheck: `npm run typecheck`

## High-level architecture
- CLI entrypoint is `src/cli.ts` using `citty` and `c12` config loading; subcommands are `translate`, `scan`, `codegen`, and `init`, with `translate` as the default when no args are passed.
- Pipeline is `scan → codegen → translate` (README): scan uses Babel parsing to extract strings (`src/scanner/*`) and can generate semantic keys via AI (`scanner/key-ai.ts`), codegen rewrites ASTs (`codegen/transform.ts`), and translate diffs source/target JSON using `.translate-lock.json` hashes (`src/diff.ts`) before calling the AI model (`src/translate.ts`).
- Locale files are written via `writeTranslation` (nested JSON via `flatten/unflatten`), and lock/map files live in `messagesDir` (`.translate-lock.json`, `.translate-map.json`).

## Key conventions
- Config is `translate-kit.config.ts` (ESM) loaded via `c12`; `defineConfig` is a typed passthrough helper.
- Internal imports use `.js` extensions even in TS sources (ESM output).
- Two modes: `keys` (uses `t("key")` + `useTranslations` import from `scan.i18nImport`) and `inline` (wraps with `<T id="...">` and uses `t(text, key)` with `inline.componentPath`).
- `messagesDir` is the source of truth for locale JSON plus lock/map files; incremental translation depends on the lock file hashes, and inline mode relies on `.translate-map.json` text→key mappings.
