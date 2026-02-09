# translate-kit

AI-powered i18n for your codebase. Scan, transform, and translate — at build time.

[![npm version](https://img.shields.io/npm/v/translate-kit.svg)](https://www.npmjs.com/package/translate-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/guillermolg00/translate-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/guillermolg00/translate-kit/actions/workflows/ci.yml)

translate-kit extracts translatable strings from your JSX/TSX, generates semantic keys with AI, replaces hardcoded text with i18n calls, and translates everything to your target locales — using your own AI models via [Vercel AI SDK](https://sdk.vercel.ai/). Compatible with [next-intl](https://next-intl.dev/).

**[Documentation](https://translate-kit.com/docs)** · **[Getting Started](https://translate-kit.com/docs/getting-started)** · **[Configuration](https://translate-kit.com/docs/configuration)**

---

## Features

- **Build-time AI translation** — no runtime overhead, translations are generated at build time
- **Incremental** — lock file tracks source hashes, re-runs only translate what changed
- **Any AI provider** — OpenAI, Anthropic, Google, Mistral, Groq, or any Vercel AI SDK provider
- **Scanner** — extract translatable strings from JSX/TSX using Babel AST analysis
- **Codegen** — replace hardcoded strings with `t()` calls or `<T>` components automatically
- **Two modes** — keys mode (`t("key")`) or inline mode (`<T id="key">text</T>`)
- **next-intl ready** — generates `useTranslations`-compatible message files

## Quick Start

```bash
# Install translate-kit and an AI provider
bun add translate-kit @ai-sdk/openai

# Interactive setup
bunx translate-kit init

# Translate
bunx translate-kit translate
```

The `init` wizard creates your config, sets up locales, and optionally runs the full pipeline.

> See the full [Getting Started](https://translate-kit.com/docs/getting-started) guide for detailed setup instructions.

## How It Works

```
scan → codegen → translate
```

| Step | What it does |
|------|-------------|
| **scan** | Parses JSX/TSX files, extracts translatable strings, generates semantic keys via AI |
| **codegen** | Replaces hardcoded strings with `t("key")` calls or `<T>` components, injects imports |
| **translate** | Diffs source messages against lock file, translates only new/modified keys |

You can use any step independently. The `translate` command is the most commonly used on its own — write your source messages and let translate-kit handle the rest.

## Configuration

```ts
// translate-kit.config.ts
import { defineConfig } from "translate-kit";
import { openai } from "@ai-sdk/openai";

export default defineConfig({
  model: openai("gpt-4o-mini"),
  sourceLocale: "en",
  targetLocales: ["es", "fr", "de", "ja"],
  messagesDir: "./messages",
});
```

> See the full [Configuration reference](https://translate-kit.com/docs/configuration) for all options including translation context, glossary, tone, batching, and scanner settings.

## Two Modes

### Keys mode (default)

Hardcoded strings are replaced with `t("key")` calls. Source text lives in JSON files.

```tsx
// Before
<h1>Welcome back</h1>

// After
<h1>{t("hero.welcomeBack")}</h1>
```

### Inline mode

Source text stays visible in your code. A `<T>` component handles runtime resolution.

```tsx
// Before
<h1>Welcome back</h1>

// After
<h1><T id="hero.welcomeBack">Welcome back</T></h1>
```

> See the [Inline Mode](https://translate-kit.com/docs/guides/inline-mode) guide for setup and usage.

## AI Providers

Any [Vercel AI SDK](https://sdk.vercel.ai/) provider works. Install the provider package and set your API key:

```bash
bun add @ai-sdk/openai       # OpenAI
bun add @ai-sdk/anthropic    # Anthropic
bun add @ai-sdk/google       # Google
bun add @ai-sdk/mistral      # Mistral
bun add @ai-sdk/groq         # Groq
```

```ts
import { openai } from "@ai-sdk/openai";       // model: openai("gpt-4o-mini")
import { anthropic } from "@ai-sdk/anthropic";  // model: anthropic("claude-sonnet-4-20250514")
import { google } from "@ai-sdk/google";        // model: google("gemini-2.0-flash")
```

> See the [AI Providers](https://translate-kit.com/docs/guides/providers) guide for all providers and recommended models.

## Commands

### `translate-kit init`

Interactive setup wizard. Creates config, scaffolds i18n integration, and optionally runs the full pipeline.

```bash
bunx translate-kit init
```

### `translate-kit scan`

Extracts translatable strings from your source code and generates semantic keys with AI.

```bash
bunx translate-kit scan           # Scan and generate keys
bunx translate-kit scan --dry-run # Preview found strings
```

### `translate-kit codegen`

Replaces hardcoded strings with i18n calls and injects imports/hooks.

```bash
bunx translate-kit codegen           # Transform source files
bunx translate-kit codegen --dry-run # Preview changes
```

### `translate-kit translate`

Translates messages to all target locales. Only new or modified keys are sent to the AI.

```bash
bunx translate-kit translate              # Translate all locales
bunx translate-kit translate --locale es  # Only Spanish
bunx translate-kit translate --dry-run    # Preview what would be translated
bunx translate-kit translate --force      # Ignore cache, re-translate everything
```

> See the [Commands](https://translate-kit.com/docs/commands/init) documentation for detailed usage and flags.

## Incremental Translations

A `.translate-lock.json` file stores SHA-256 hashes of source values. On each run, translate-kit computes a diff:

- **Added** — new keys, not yet translated
- **Modified** — source text changed since last translation
- **Unchanged** — hash matches, skipped
- **Removed** — keys no longer in source, cleaned up

Only added and modified keys are sent to the AI. This keeps API calls fast and costs low.

> See the [Incremental Translations](https://translate-kit.com/docs/guides/incremental) guide for details.

## Documentation

Full documentation is available at **[translate-kit.com](https://translate-kit.com/docs)**.

- [Getting Started](https://translate-kit.com/docs/getting-started)
- [Configuration](https://translate-kit.com/docs/configuration)
- [AI Providers](https://translate-kit.com/docs/guides/providers)
- [Inline Mode](https://translate-kit.com/docs/guides/inline-mode)
- [Incremental Translations](https://translate-kit.com/docs/guides/incremental)
- [next-intl Integration](https://translate-kit.com/docs/guides/next-intl)

## License

MIT
