import Link from "next/link";
import { CLIScroll } from "./components/cli-scroll";

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="flex min-h-[85vh] flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-sm uppercase tracking-widest text-fd-muted-foreground">
          translate-kit
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
          i18n that writes itself
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-fd-muted-foreground sm:text-xl">
          From bare strings to fully translated app — at build time, with AI.
          <br className="hidden sm:block" />
          One CLI. Any provider. Zero runtime.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-7 py-3.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/guillermolg00/translate-kit"
            className="rounded-lg border border-fd-border px-7 py-3.5 text-sm font-medium transition-colors hover:bg-fd-accent"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
        <p className="mt-8 text-xs text-fd-muted-foreground/60">
          Works with next-intl &middot; Powered by Vercel AI SDK
        </p>
        <div className="mt-12 animate-bounce text-fd-muted-foreground">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </section>

      {/* Section header */}
      <div className="px-6 pb-8 text-center">
        <p className="font-mono text-sm uppercase tracking-widest text-fd-muted-foreground">
          How it works
        </p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
          Five steps. One minute.
        </h2>
      </div>

      {/* CLI pipeline */}
      <CLIScroll />

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-32">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            title="Any AI Provider"
            description="OpenAI, Anthropic, Google, Mistral, Groq — any Vercel AI SDK provider works."
          />
          <Feature
            title="Incremental"
            description="Lock file tracks source hashes. Re-runs only translate what changed."
          />
          <Feature
            title="Two Modes"
            description='Keys mode with t("key") or inline mode with <T> components. Your choice.'
          />
          <Feature
            title="next-intl Ready"
            description="Generates useTranslations-compatible message files out of the box."
          />
          <Feature
            title="Scanner + Codegen"
            description="Extract strings and replace them with i18n calls automatically."
          />
          <Feature
            title="Zero Runtime"
            description="All translation happens at build time. No client-side overhead."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center px-6 pb-32 text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">Ready to translate?</h2>
        <p className="mt-4 text-lg text-fd-muted-foreground">
          Get started in under a minute.
        </p>
        <div className="mt-8">
          <Link
            href="/docs/getting-started"
            className="rounded-lg bg-fd-primary px-7 py-3.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Get Started
          </Link>
        </div>
      </section>
    </main>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-fd-border p-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
        {description}
      </p>
    </div>
  );
}
