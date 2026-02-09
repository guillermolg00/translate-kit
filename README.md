# translate-kit

AI-powered translation SDK for build time. No intermediaries, no vendor lock-in.

[![npm version](https://img.shields.io/npm/v/translate-kit.svg)](https://www.npmjs.com/package/translate-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/guillermolg00/translate-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/guillermolg00/translate-kit/actions/workflows/ci.yml)

Uses your own AI models via [Vercel AI SDK](https://sdk.vercel.ai/) to translate your app at build time. Compatible with [next-intl](https://next-intl.dev/).

## Features

- **Build-time AI translation** — translate JSON message files using any AI model
- **Incremental** — only new or modified keys get translated via a lock file system
- **Any provider** — OpenAI, Anthropic, Google, Mistral, Groq, or any Vercel AI SDK provider
- **Scanner** — extract translatable strings from JSX/TSX source code automatically
- **Codegen** — replace hardcoded strings with `t()` calls and inject imports/hooks
- **next-intl ready** — generates `useTranslations`-compatible message files

## Quick Start

```bash
# Install
npm install translate-kit @ai-sdk/openai
# or
bun add translate-kit @ai-sdk/openai

# Create config
npx translate-kit init

# Translate
npx translate-kit translate
```

## Configuration

```ts
// translate-kit.config.ts
import { defineConfig } from "translate-kit";
import { openai } from "@ai-sdk/openai";

export default defineConfig({
  model: openai("gpt-4o-mini"),
  sourceLocale: "en",
  targetLocales: ["es", "fr", "de"],
  messagesDir: "./messages",

  translation: {
    batchSize: 50,
    concurrency: 3,
    context: "SaaS application for project management",
    glossary: { Acme: "Acme" },
    tone: "professional",
    retries: 2,
  },

  scan: {
    include: ["src/**/*.tsx", "app/**/*.tsx"],
    exclude: ["**/*.test.*"],
    keyStrategy: "hash",
    translatableProps: ["placeholder", "title", "alt", "aria-label"],
    i18nImport: "next-intl",
  },
});
```

## Commands

### `translate-kit translate`

Translate messages to all target locales.

```bash
translate-kit translate              # Translate all locales
translate-kit translate --locale es  # Only Spanish
translate-kit translate --dry-run    # Preview without translating
translate-kit translate --force      # Re-translate everything
translate-kit translate --verbose    # Verbose output
```

### `translate-kit scan`

Scan source code for translatable strings (JSX text, attributes, object properties).

```bash
translate-kit scan           # Scan and write to source locale file
translate-kit scan --dry-run # Preview found strings
```

### `translate-kit codegen`

Replace hardcoded strings with `t()` calls and inject `useTranslations` imports.

```bash
translate-kit codegen           # Transform source files
translate-kit codegen --dry-run # Preview changes
```

### `translate-kit init`

Interactive setup wizard. Creates a config file, optionally scaffolds next-intl integration, and can run the full pipeline (scan → codegen → translate).

## How It Works

```
scan → codegen → translate
```

1. **Scan** — parse JSX/TSX files with Babel, extract translatable strings, generate semantic keys via AI, write source locale JSON
2. **Codegen** — replace hardcoded strings with `t("key")` calls, add `useTranslations` imports and hooks
3. **Translate** — diff source messages against lock file, translate only new/modified keys, write target locale JSONs

Only changed keys are sent to the AI. A `.translate-lock.json` file tracks source hashes so re-runs are fast and cheap.

## AI Providers

translate-kit works with any provider supported by Vercel AI SDK:

```ts
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { mistral } from "@ai-sdk/mistral";

// OpenAI
model: openai("gpt-4o-mini")

// Anthropic
model: anthropic("claude-sonnet-4-20250514")

// Google
model: google("gemini-2.0-flash")

// Mistral
model: mistral("mistral-large-latest")
```

## Scanner

The scanner extracts translatable strings from your source code:

- **JSX text** — `<h1>Welcome</h1>`
- **JSX attributes** — `<input placeholder="Enter name" />`
- **Expression containers** — `<div>{"Hello"}</div>`
- **Object properties** — `{ title: "Dashboard" }`

It automatically filters out non-translatable content like URLs, CSS classes, constants, and code identifiers. Keys are generated using AI for semantic, namespace-style naming (`common.save`, `nav.dashboard`, `form.enterName`).

## Docs

Full documentation available at [translate-kit.vercel.app](https://translate-kit.vercel.app).

## License

MIT
