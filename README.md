# translate-kit

AI-powered i18n for your codebase. Scan, transform, and translate — at build time.

[![npm version](https://img.shields.io/npm/v/translate-kit.svg)](https://www.npmjs.com/package/translate-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

In 2026, manually writing i18n JSON files key by key is obsolete. translate-kit is a CLI that handles the entire translation pipeline at build time: it extracts translatable strings from your JSX/TSX, generates semantic keys with AI, replaces hardcoded text with i18n calls, and translates everything to your target locales — using your own AI models via [Vercel AI SDK](https://sdk.vercel.ai/). Compatible with [next-intl](https://next-intl.dev/).

**Zero runtime cost. Zero lock-in.** translate-kit is not a runtime dependency. It generates standard next-intl code and JSON files. If you remove it tomorrow, your app keeps working exactly the same.

**[Documentation](https://translate-kit.com/docs)** · **[Blog](https://translate-kit.com/blog)** · **[Getting Started](https://translate-kit.com/docs/getting-started)**

<p align="center">
  <img src="demo-init.gif" alt="translate-kit init demo" />
</p>

---

## Quick Start

```bash
# Interactive setup — scaffolds config, installs next-intl, runs the full pipeline
npx translate-kit init
```

That's it. No global install needed — just run it with `npx` (or `bunx`). The `init` wizard creates your config, sets up locales, and optionally scans + transforms + translates your entire codebase in one step.

> See the full [Getting Started](https://translate-kit.com/docs/getting-started) guide for detailed setup.

## How It Works

```
scan → codegen → translate
```

| Step | What it does |
|------|-------------|
| **scan** | Parses JSX/TSX with Babel, extracts translatable strings (text, attributes, template literals, ternaries), generates semantic keys via AI |
| **codegen** | Replaces hardcoded strings with `t("key")` calls or `<T>` wrappers, injects imports and hooks, detects server/client components |
| **translate** | Diffs source messages against a lock file (SHA-256 hashes), only sends new/modified keys to the AI, writes target locale files |

Run the full pipeline with one command:

```bash
npx translate-kit run
```

Or use each step independently. `translate` is the most common standalone command — write your source messages manually and let translate-kit handle the rest.

## Features

### Build-time, not runtime

Translation happens before your app ships. No client-side SDK, no loading spinners, no flash of untranslated content. The output is static JSON files that next-intl reads at render time.

### Any AI provider

Works with any [Vercel AI SDK](https://sdk.vercel.ai/) provider. You pick the model, you control the cost.

```bash
npm install @ai-sdk/openai       # OpenAI (install as devDependency)
npm install @ai-sdk/anthropic    # Anthropic
npm install @ai-sdk/google       # Google
npm install @ai-sdk/mistral      # Mistral
npm install @ai-sdk/groq         # Groq
```

```ts
import { openai } from "@ai-sdk/openai";       // model: openai("gpt-4o-mini")
import { anthropic } from "@ai-sdk/anthropic";  // model: anthropic("claude-sonnet-4-20250514")
import { google } from "@ai-sdk/google";        // model: google("gemini-2.0-flash")
```

### Incremental by default

A `.translate-lock.json` file tracks SHA-256 hashes of every source value. Re-runs only translate what changed. Costs stay predictable.

### Smart extraction

The scanner parses your AST and understands which strings are user-facing text vs. code artifacts (CSS classes, URLs, constants). It extracts JSX text, attributes, template literals, conditional expressions, and object properties automatically.

### Namespace scoping

Codegen detects when all keys in a component share the same prefix and generates `useTranslations("hero")` instead of `useTranslations()`. Keys are stripped to their local form: `t("welcome")` instead of `t("hero.welcome")`. This lets next-intl tree-shake messages per component.

### Selective client payload

The generated layout only sends namespaces used by client components to `NextIntlClientProvider`. If your app has 20 namespaces but only 4 are used in client components, the client bundle shrinks proportionally.

### Type safety

Enable `typeSafe: true` and translate-kit auto-generates a `next-intl.d.ts` file on every scan — full autocomplete and compile-time validation for all message keys.

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
  splitByNamespace: true,
  typeSafe: true,
  translation: {
    context: "SaaS application for project management",
    glossary: { "Acme": "Acme" },
    tone: "professional",
  },
});
```

> See the [Configuration reference](https://translate-kit.com/docs/configuration) for all options.

## Two Modes

### Keys mode (default)

Strings are replaced with `t("key")` calls. Source text moves to JSON files.

```tsx
// Before
<h1>Welcome back</h1>

// After
<h1>{t("welcomeBack")}</h1>
```

### Inline mode

Source text stays visible in your code. A `<T>` component handles runtime resolution.

```tsx
// Before
<h1>Welcome back</h1>

// After
<h1><T id="hero.welcomeBack">Welcome back</T></h1>
```

> See the [Inline Mode](https://translate-kit.com/docs/guides/inline-mode) guide for setup.

## Commands

| Command | Description |
|---------|-------------|
| `translate-kit init` | Interactive setup wizard |
| `translate-kit run` | Full pipeline: scan + codegen + translate |
| `translate-kit scan` | Extract strings and generate keys |
| `translate-kit codegen` | Replace strings with i18n calls |
| `translate-kit translate` | Translate to target locales (incremental) |
| `translate-kit typegen` | Generate TypeScript types for keys |
| `translate-kit rules` | Generate AI agent rule files (Claude, Cursor, Copilot) |

All commands support `--dry-run` to preview changes and `--verbose` for detailed output. `translate` and `run` support `--force` to ignore the cache.

> See the [Commands](https://translate-kit.com/docs/commands/init) documentation for flags and examples.

## Per-Namespace Splitting

With `splitByNamespace: true`, messages are written as individual files instead of one monolithic JSON:

```
messages/en/hero.json     → { "welcome": "Welcome", "getStarted": "Get started" }
messages/en/common.json   → { "save": "Save", "cancel": "Cancel" }
messages/en/auth.json     → { "signIn": "Sign in", "signOut": "Sign out" }
```

This enables granular code-splitting and keeps diffs clean.

## Current Limitations

translate-kit handles around 95% of translatable content in a typical codebase. Patterns not yet supported:

- Strings in standalone variables and constants (`const title = "Welcome"`)
- Non-JSX files (API responses, error messages in plain `.ts` files)
- Currently next-intl / Next.js only — other i18n runtimes are on the roadmap

For these cases, add keys manually to your source locale JSON and translate-kit will translate them along with everything else.

> See the [full limitations page](https://translate-kit.com/docs/technical/limitations) for details.

## AI Agent Rules

Teach your AI coding agent to run the translation pipeline automatically after modifying user-facing strings:

```bash
bunx skills add https://github.com/guillermolg00/translate-kit --skill translate-kit
```

## Documentation

Full documentation at **[translate-kit.com](https://translate-kit.com/docs)**.

- [Getting Started](https://translate-kit.com/docs/getting-started)
- [Configuration](https://translate-kit.com/docs/configuration)
- [AI Providers](https://translate-kit.com/docs/guides/providers)
- [Inline Mode](https://translate-kit.com/docs/guides/inline-mode)
- [next-intl Integration](https://translate-kit.com/docs/guides/next-intl)
- [Architecture](https://translate-kit.com/docs/technical/architecture)

## License

MIT
