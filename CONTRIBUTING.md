# Contributing to translate-kit

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/guillermolg00/translate-kit.git
cd translate-kit

# Install dependencies
bun install

# Run tests
bun run test

# Typecheck
bun run typecheck

# Build
bun run build
```

### Website (docs)

```bash
cd website
bun install
bun dev
```

## Making Changes

1. **Fork** the repo and create a branch from `main`
2. **Install** dependencies with `bun install`
3. **Make** your changes
4. **Add tests** if you're adding or changing functionality
5. **Run** `bun run test` and `bun run typecheck` to verify everything passes
6. **Commit** with a clear message (see below)
7. **Open a PR** against `main`

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add support for vue files in scanner
fix: handle empty translation batches
docs: update provider configuration examples
refactor: extract shared helpers in transform
test: add inline mode codegen tests
```

Prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

## Project Structure

```
src/
  cli.ts              # CLI entry point (citty commands)
  config.ts           # Config loading and validation (zod)
  diff.ts             # Lock file diffing
  flatten.ts          # JSON flatten/unflatten
  translate.ts        # AI translation via Vercel AI SDK
  writer.ts           # File writing utilities
  init.ts             # Interactive setup wizard
  logger.ts           # Logging utilities
  scanner/
    extractor.ts      # Babel AST string extraction
    filters.ts        # String filtering rules
    key-ai.ts         # AI-powered key generation
    key-generator.ts  # Hash/path key strategies
    index.ts          # Scanner orchestrator
  codegen/
    transform.ts      # AST transformation (keys + inline modes)
    index.ts          # Codegen orchestrator
  templates/
    t-component.ts    # <T> component templates for inline mode
  utils/
    ast-helpers.ts    # Shared Babel AST utilities
tests/                # Vitest tests mirroring src/ structure
website/              # Next.js docs site (Fumadocs)
```

## Running Tests

```bash
bun run test          # Run all tests
bun run test:watch    # Watch mode
```

Tests live in `tests/` and mirror the `src/` structure. Add tests for any new functionality.

## Code Style

- TypeScript strict mode
- No unnecessary comments or docstrings
- Prefer explicit types over `any`
- Keep functions focused and small
- No over-engineering — solve the current problem, not hypothetical future ones

## Reporting Bugs

Use the [bug report template](https://github.com/guillermolg00/translate-kit/issues/new?template=bug_report.md) on GitHub Issues. Include:

- translate-kit version
- Node.js / Bun version
- Minimal reproduction steps
- Expected vs actual behavior

## Suggesting Features

Open a [feature request](https://github.com/guillermolg00/translate-kit/issues/new?template=feature_request.md) on GitHub Issues. Describe the problem you're trying to solve before proposing a solution.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
