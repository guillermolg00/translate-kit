# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run build        # Build CLI + library with tsup (two entry points)
bun run dev          # Build in watch mode
bun run test         # Run all tests (vitest)
npx vitest run tests/codegen/transform.test.ts  # Run a single test file
bun run typecheck    # Type-check without emitting
```

## Architecture

translate-kit is an AI-powered build-time translation SDK. It has two entry points: a CLI (`src/cli.ts`) and a library (`src/index.ts`).

### Pipeline: scan → codegen → translate

The three CLI commands form a pipeline that can run independently or together (via `init`):

1. **scan** (`src/scanner/`): Parses TSX/JSX with Babel, extracts translatable strings (JSX text, attributes, expressions), filters non-translatable content, then calls the AI model to generate semantic keys grouped by namespace. Outputs `.translate-map.json` (text→key) and source locale JSON.

2. **codegen** (`src/codegen/`): Reads the text-to-key map, re-parses source files, and transforms the AST to replace raw strings with `t("key")` calls (keys mode) or `<T id="key">text</T>` wrappers (inline mode). Validates generated syntax by re-parsing before writing.

3. **translate** (`src/translate.ts`): Loads source messages, computes a diff against `.translate-lock.json` (SHA256 hashes), and only sends added/modified keys to the AI. Merges cached translations with new ones, validates placeholder preservation, writes target locale JSON files.

### Two Modes

- **Keys mode** (default): Strings replaced with `t("key")`, works with next-intl. Source text moves to JSON files.
- **Inline mode**: Strings wrapped with `<T id="key">text</T>`, source text stays in code. Requires generated client/server components (`src/templates/t-component.ts`).

### Inline Mode Components (t-component.ts)

The server template uses React `cache` to create a per-request message store. `setServerMessages()` is called once in the root layout, making translations available to all server components via `T` and `createT()` without prop drilling. The `serverTemplate()` function takes a `clientBasename` parameter to generate the correct import path to the client component file.

### Key Modules

- `src/config.ts`: Loads `translate-kit.config.ts` via c12, validates with Zod
- `src/diff.ts`: Incremental translation via SHA256 lock file
- `src/scanner/key-ai.ts`: AI-powered semantic key generation with batching/retries
- `src/scanner/context-enricher.ts`: Adds route path and section context to extracted strings
- `src/codegen/transform.ts`: Babel AST transformation (the core of codegen)
- `src/init.ts`: Interactive wizard that scaffolds config, components, i18n helper, and modifies the root layout
- `src/logger.ts`: TTY-aware progress bar (`logProgress` is no-op when `!process.stdout.isTTY`)

### AI Integration

All AI calls use Vercel AI SDK's `generateObject` with Zod schemas. The model is configured by the user in `translate-kit.config.ts` and can be any provider (OpenAI, Anthropic, Google, Mistral, Groq). Batch processing with configurable concurrency and retries is used for both key generation and translation.

### Testing

Tests mock the `ai` module (`vi.mock("ai")`) to avoid real API calls. Codegen tests use temp directories with fixture files. All 136 tests should pass.
