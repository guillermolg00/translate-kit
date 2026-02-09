export const CLIENT_TEMPLATE = `"use client";
import { createContext, useContext, type ReactNode } from "react";

type Messages = Record<string, string>;
const I18nCtx = createContext<Messages>({});

export function I18nProvider({ messages = {}, children }: { messages?: Messages; children: ReactNode }) {
  return <I18nCtx.Provider value={messages}>{children}</I18nCtx.Provider>;
}

export function T({ id, children }: { id?: string; children: ReactNode }) {
  const msgs = useContext(I18nCtx);
  if (!id) return <>{children}</>;
  return <>{msgs[id] ?? children}</>;
}

export function useT() {
  const msgs = useContext(I18nCtx);
  return (text: string, id?: string): string => {
    if (!id) return text;
    return msgs[id] ?? text;
  };
}
`;

export const SERVER_TEMPLATE = `import type { ReactNode } from "react";

type Messages = Record<string, string>;

export function T({ id, children, messages = {} }: { id?: string; children: ReactNode; messages?: Messages }) {
  if (!id) return <>{children}</>;
  return <>{messages[id] ?? children}</>;
}

export function createT(messages: Messages = {}) {
  return (text: string, id?: string): string => {
    if (!id) return text;
    return messages[id] ?? text;
  };
}
`;

export function generateI18nHelper(opts: {
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
}): string {
  const allLocales = [opts.sourceLocale, ...opts.targetLocales];
  const allLocalesStr = allLocales.map((l) => `"${l}"`).join(", ");
  return `import { headers } from "next/headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const supported = [${allLocalesStr}] as const;
type Locale = (typeof supported)[number];
const defaultLocale: Locale = "${opts.sourceLocale}";

function parseAcceptLanguage(header: string): Locale {
  const langs = header
    .split(",")
    .map((part) => {
      const [lang, q] = part.trim().split(";q=");
      return { lang: lang.split("-")[0].toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of langs) {
    if (supported.includes(lang as Locale)) return lang as Locale;
  }
  return defaultLocale;
}

export async function getLocale(): Promise<Locale> {
  const h = await headers();
  const acceptLang = h.get("accept-language") ?? "";
  return parseAcceptLanguage(acceptLang);
}

export async function getMessages(locale: string): Promise<Record<string, string>> {
  if (locale === defaultLocale) return {};
  try {
    const filePath = join(process.cwd(), "${opts.messagesDir}", \`\${locale}.json\`);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
`;
}
