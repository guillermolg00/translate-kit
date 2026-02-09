# translate-kit

AI-powered translation SDK for build time. Compatible with [next-intl](https://next-intl.dev/). No intermediaries, no vendor lock-in.

Uses your own AI models via [Vercel AI SDK](https://sdk.vercel.ai/) to generate translations at build time.

## Quick Start

```bash
# Install
bun add translate-kit @ai-sdk/openai

# Create config
bunx translate-kit init

# Translate
bunx translate-kit translate
```

## Configuration

```ts
// translate-kit.config.ts
import { defineConfig } from "translate-kit";
import { openai } from "@ai-sdk/openai";

export default defineConfig({
  model: openai("gpt-4o-mini"),
  sourceLocale: "en",
  targetLocales: ["es", "ru", "pt"],
  messagesDir: "./messages",

  translation: {
    batchSize: 50,
    context: "SaaS application for project management",
    glossary: { "Acme": "Acme" },
    tone: "professional",
  },
});
```

## How It Works

1. Write your source messages in `messages/en.json` (or use the scanner)
2. Run `translate-kit translate`
3. Get translated files: `messages/es.json`, `messages/ru.json`, etc.

Only new or modified keys get translated. A lock file tracks what's been translated so re-runs are fast and cheap.

## Commands

### `translate-kit translate`

Translate messages to all target locales.

```bash
translate-kit translate              # Translate all locales
translate-kit translate --locale es  # Only Spanish
translate-kit translate --dry-run    # Preview without translating
translate-kit translate --force      # Re-translate everything
```

### `translate-kit scan`

Scan source code for translatable strings (JSX text, attributes).

```bash
translate-kit scan           # Scan and write to source locale file
translate-kit scan --dry-run # Preview found strings
```

Requires `scan` config:

```ts
export default defineConfig({
  // ...
  scan: {
    include: ["src/**/*.tsx", "app/**/*.tsx"],
    exclude: ["**/*.test.*"],
    keyStrategy: "hash", // "hash" (stable) or "path" (readable)
    translatableProps: ["placeholder", "title", "alt", "aria-label"],
  },
});
```

### `translate-kit init`

Generate a starter config file.

## Use Any AI Provider

translate-kit works with any provider supported by Vercel AI SDK:

```ts
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

// OpenAI
model: openai("gpt-4o-mini")

// Anthropic
model: anthropic("claude-sonnet-4-20250514")

// Google
model: google("gemini-1.5-flash")
```

## License

MIT
