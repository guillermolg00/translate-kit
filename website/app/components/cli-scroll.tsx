"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface TLine {
  text: string;
  type:
    | "command"
    | "success"
    | "info"
    | "dim"
    | "blank"
    | "result"
    | "file"
    | "mapping";
}

interface Step {
  id: string;
  number: string;
  title: string;
  description: string;
  lines: TLine[];
}

const steps: Step[] = [
  {
    id: "install",
    number: "01",
    title: "Install",
    description: "One package. That's all you need.",
    lines: [
      {
        text: "bun add translate-kit @ai-sdk/openai next-intl",
        type: "command",
      },
      { text: "", type: "blank" },
      { text: "installed translate-kit", type: "dim" },
    ],
  },
  {
    id: "configure",
    number: "02",
    title: "Configure",
    description:
      "The interactive wizard sets up everything. Pick your AI provider, mode, languages, and optionally runs the full pipeline.",
    lines: [
      { text: "bunx translate-kit init", type: "command" },
      { text: "", type: "blank" },
      { text: "\u250c  translate-kit setup", type: "info" },
      { text: "\u2502", type: "dim" },
      { text: "\u25c7  Translation mode: Inline mode", type: "result" },
      { text: "\u25c7  AI provider: OpenAI", type: "result" },
      { text: "\u25c7  Model: gpt-4o-mini", type: "result" },
      { text: "\u25c7  Source locale: en", type: "result" },
      { text: "\u25c7  Target locales: Spanish (es)", type: "result" },
      { text: "\u25c7  Messages directory: ./messages", type: "result" },
      { text: "\u25c7  Component path: @/components/t", type: "result" },
      { text: "\u25c7  Tone: Formal", type: "result" },
      { text: "\u2502", type: "dim" },
      { text: "\u25c6  Created translate-kit.config.ts", type: "success" },
      { text: "\u25c6  Created inline components", type: "success" },
      { text: "\u25c6  Configured i18n + layout", type: "success" },
      { text: "\u2502", type: "dim" },
      { text: "\u25c7  Run full pipeline? Yes", type: "result" },
      { text: "", type: "blank" },
      { text: "\u25c7  Scanning... 876 strings from 412 files", type: "dim" },
      { text: "\u25c7  Generating keys... done", type: "dim" },
      { text: "\u25c7  Codegen... 763 strings wrapped in 217 files", type: "dim" },
      { text: "\u25c7  Translating es... done", type: "dim" },
      { text: "\u2502", type: "dim" },
      { text: "\u25cf  62,934 in + 15,649 out = 78,583 tokens \u00b7 ~$0.02", type: "info" },
      { text: "\u2502", type: "dim" },
      { text: "\u2514  You're all set!", type: "success" },
    ],
  },
  {
    id: "scan",
    number: "03",
    title: "Scan",
    description:
      "Finds every translatable string in your codebase. AI generates semantic keys automatically.",
    lines: [
      { text: "bunx translate-kit scan", type: "command" },
      { text: "", type: "blank" },
      { text: "Scanning src/**/*.tsx...", type: "dim" },
      { text: "Found 47 strings in 12 files", type: "result" },
      { text: "", type: "blank" },
      { text: "Generating semantic keys...", type: "dim" },
      { text: "", type: "blank" },
      { text: "\u2713 .translate-map.json (47 keys)", type: "success" },
      { text: "\u2713 messages/en.json", type: "success" },
    ],
  },
  {
    id: "transform",
    number: "04",
    title: "Transform",
    description:
      "Replaces hardcoded strings with i18n calls. Adds imports automatically. Zero manual work.",
    lines: [
      { text: "bunx translate-kit codegen", type: "command" },
      { text: "", type: "blank" },
      { text: "src/app/page.tsx", type: "file" },
      {
        text: '  "Welcome back" \u2192 t("hero.welcomeBack")',
        type: "mapping",
      },
      {
        text: '  "Get started"  \u2192 t("cta.getStarted")',
        type: "mapping",
      },
      { text: "", type: "blank" },
      { text: "src/components/nav.tsx", type: "file" },
      { text: '  "Sign in"  \u2192 t("nav.signIn")', type: "mapping" },
      { text: '  "Sign out" \u2192 t("nav.signOut")', type: "mapping" },
      { text: "", type: "blank" },
      { text: "\u2713 47 strings replaced in 12 files", type: "success" },
    ],
  },
  {
    id: "translate",
    number: "05",
    title: "Translate",
    description:
      "AI translates only what changed. Incremental by default. Run it and forget.",
    lines: [
      { text: "bunx translate-kit translate", type: "command" },
      { text: "", type: "blank" },
      { text: "Translating en \u2192 4 locales...", type: "dim" },
      { text: "", type: "blank" },
      { text: "\u2713 es  47 keys  1.2s", type: "success" },
      { text: "\u2713 fr  47 keys  1.1s", type: "success" },
      { text: "\u2713 de  47 keys  1.3s", type: "success" },
      { text: "\u2713 ja  47 keys  1.5s", type: "success" },
      { text: "", type: "blank" },
      { text: "Done \u2014 188 translations \u2713", type: "success" },
    ],
  },
];

function Line({ line }: { line: TLine }) {
  if (line.type === "blank") return <div className="h-5" />;

  const styles: Record<string, string> = {
    command: "text-white font-semibold",
    success: "text-green-400",
    info: "text-cyan-400",
    dim: "text-neutral-500",
    result: "text-neutral-300",
    file: "text-blue-400 font-semibold",
    mapping: "text-neutral-400",
  };

  return (
    <div className={styles[line.type]}>
      {line.type === "command" && (
        <span className="text-green-400 select-none">$ </span>
      )}
      {line.text}
    </div>
  );
}

function TerminalChrome({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900/40 shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-neutral-800/50  border-b border-neutral-700">
        <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <div className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-xs text-neutral-500">
          ~/my-app
        </span>
      </div>
      {children}
    </div>
  );
}

function AnimatedTerminal({ activeStep }: { activeStep: number }) {
  return (
    <TerminalChrome>
      <div className="relative h-[340px]">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className={`absolute inset-0 p-5 font-mono text-sm leading-relaxed transition-all duration-500 ${
              i === activeStep
                ? "opacity-100 translate-y-0"
                : i < activeStep
                  ? "opacity-0 -translate-y-3"
                  : "opacity-0 translate-y-3"
            }`}
          >
            {step.lines.map((line, j) => (
              <Line key={j} line={line} />
            ))}
          </div>
        ))}
      </div>
    </TerminalChrome>
  );
}

function StaticTerminal({ lines }: { lines: TLine[] }) {
  return (
    <TerminalChrome>
      <div className="p-5 font-mono text-sm leading-relaxed">
        {lines.map((line, j) => (
          <Line key={j} line={line} />
        ))}
      </div>
    </TerminalChrome>
  );
}

export function CLIScroll() {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    function handleScroll() {
      const target = window.innerHeight * 0.4;
      let closest = 0;
      let minDist = Infinity;

      for (let i = 0; i < stepRefs.current.length; i++) {
        const el = stepRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - target);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }

      setActiveStep(closest);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <section className="relative mx-auto max-w-6xl px-6">
      <div className="lg:flex lg:gap-16">
        {/* Sticky terminal — desktop */}
        <div className="hidden lg:block lg:w-[55%]">
          <div className="sticky top-[25vh]">
            <AnimatedTerminal activeStep={activeStep} />
          </div>
        </div>

        {/* Steps */}
        <div className="lg:w-[45%]">
          {steps.map((step, i) => (
            <div
              key={step.id}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              className="flex min-h-[50vh] items-center"
            >
              <div
                className={`w-full transition-all duration-500 ${
                  i === activeStep
                    ? "opacity-100 translate-x-0"
                    : "opacity-20 lg:translate-x-2"
                }`}
              >
                <span className="font-mono text-sm text-fd-muted-foreground">
                  {step.number}
                </span>
                <h3 className="mt-1 text-3xl font-bold">{step.title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-fd-muted-foreground">
                  {step.description}
                </p>
                {/* Inline terminal — mobile */}
                <div className="mt-6 lg:hidden">
                  <StaticTerminal lines={step.lines} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
