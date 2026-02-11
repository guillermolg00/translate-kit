export const CLIENT_TEMPLATE = `"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";

type Messages = Record<string, string>;
const I18nCtx = createContext<Messages>({});

export function I18nProvider({ messages = {}, locale, children }: { messages?: Messages; locale?: string; children: ReactNode }) {
  useEffect(() => {
    if (locale) {
      document.cookie = \`NEXT_LOCALE=\${locale}; path=/; max-age=31536000; SameSite=Lax\`;
    }
  }, [locale]);
  return <I18nCtx.Provider value={messages}>{children}</I18nCtx.Provider>;
}

export function T({ id, children }: { id?: string; children: ReactNode }) {
  const msgs = useContext(I18nCtx);
  if (!id) return <>{children}</>;
  return <>{msgs[id] ?? children}</>;
}

export function useT() {
  const msgs = useContext(I18nCtx);
  return (text: string, id?: string, values?: Record<string, string | number>): string => {
    const raw = id ? (msgs[id] ?? text) : text;
    if (!values) return raw;
    return raw.replace(/\\{(\\w+)\\}/g, (_, k) => String(values[k] ?? \`{\${k}}\`));
  };
}
`;

export function serverTemplate(
  clientBasename: string,
  opts?: {
    sourceLocale: string;
    targetLocales: string[];
    messagesDir: string;
  },
): string {
  if (!opts) {
    // Legacy fallback (no lazy loading)
    return `import type { ReactNode } from "react";
import { cache } from "react";
export { I18nProvider } from "./${clientBasename}";

type Messages = Record<string, string>;

// Per-request message store using React cache
const getMessageStore = cache(() => ({ current: {} as Messages }));

export function setServerMessages(messages: Messages) {
  getMessageStore().current = messages;
}

export function T({ id, children, messages }: { id?: string; children: ReactNode; messages?: Messages }) {
  if (!id) return <>{children}</>;
  const msgs = messages ?? getMessageStore().current;
  return <>{msgs[id] ?? children}</>;
}

export function createT(messages?: Messages) {
  return (text: string, id?: string, values?: Record<string, string | number>): string => {
    const msgs = messages ?? getMessageStore().current;
    const raw = id ? (msgs[id] ?? text) : text;
    if (!values) return raw;
    return raw.replace(/\\{(\\w+)\\}/g, (_, k) => String(values[k] ?? \`{\${k}}\`));
  };
}
`;
  }

  const allLocales = [opts.sourceLocale, ...opts.targetLocales];
  const allLocalesStr = allLocales.map((l) => `"${l}"`).join(", ");

  return `import type { ReactNode } from "react";
import { cache } from "react";
export { I18nProvider } from "./${clientBasename}";

type Messages = Record<string, string>;

const supported = [${allLocalesStr}] as const;
type Locale = (typeof supported)[number];
const defaultLocale: Locale = "${opts.sourceLocale}";
const messagesDir = "${opts.messagesDir}";

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

const getLocaleStore = cache(() => ({ current: null as string | null }));

export function setLocale(locale: string) {
  getLocaleStore().current = locale;
}

// Per-request cached message loading — works even when layout is cached during client-side navigation
// Uses dynamic imports so this file can be safely imported from client components
const getCachedMessages = cache(async (): Promise<Messages> => {
  let locale: Locale | null = getLocaleStore().current as Locale | null;

  if (!locale) {
    try {
      const { cookies } = await import("next/headers");
      const c = await cookies();
      const cookieLocale = c.get("NEXT_LOCALE")?.value;
      if (cookieLocale && supported.includes(cookieLocale as Locale)) {
        locale = cookieLocale as Locale;
      }
    } catch {}
  }

  if (!locale) {
    const { headers } = await import("next/headers");
    const h = await headers();
    const acceptLang = h.get("accept-language") ?? "";
    locale = parseAcceptLanguage(acceptLang);
  }

  if (locale === defaultLocale) return {};
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const filePath = join(process.cwd(), messagesDir, \`\${locale}.json\`);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
});

// Per-request message store (populated by setServerMessages in layout)
const getMessageStore = cache(() => ({ current: null as Messages | null }));

export function setServerMessages(messages: Messages) {
  getMessageStore().current = messages;
}

async function resolveMessages(explicit?: Messages): Promise<Messages> {
  if (explicit) return explicit;
  const store = getMessageStore().current;
  if (store) return store;
  return getCachedMessages();
}

export async function T({ id, children, messages }: { id?: string; children: ReactNode; messages?: Messages }) {
  if (!id) return <>{children}</>;
  const msgs = await resolveMessages(messages);
  // Populate store so sync createT() calls in the same request benefit
  if (!messages && !getMessageStore().current) {
    getMessageStore().current = msgs;
  }
  return <>{msgs[id] ?? children}</>;
}

type TFn = (text: string, id?: string, values?: Record<string, string | number>) => string;

// Backward-compatible: works both as sync createT() and async await createT()
// - Sync: reads from store (works when layout called setServerMessages)
// - Async: lazily loads messages from filesystem (works during client-side navigation)
export function createT(messages?: Messages): TFn & PromiseLike<TFn> {
  const t: TFn = (text, id, values) => {
    const msgs = messages ?? getMessageStore().current ?? {};
    const raw = id ? (msgs[id] ?? text) : text;
    if (!values) return raw;
    return raw.replace(/\\{(\\w+)\\}/g, (_, k) => String(values[k] ?? \`{\${k}}\`));
  };

  const asyncResult = resolveMessages(messages).then(msgs => {
    if (!messages && !getMessageStore().current) {
      getMessageStore().current = msgs;
    }
    const bound: TFn = (text, id, values) => {
      const raw = id ? (msgs[id] ?? text) : text;
      if (!values) return raw;
      return raw.replace(/\\{(\\w+)\\}/g, (_, k) => String(values[k] ?? \`{\${k}}\`));
    };
    return bound;
  });

  return Object.assign(t, { then: asyncResult.then.bind(asyncResult) });
}
`;
}

export function generateI18nHelper(opts: {
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
}): string {
  const allLocales = [opts.sourceLocale, ...opts.targetLocales];
  const allLocalesStr = allLocales.map((l) => `"${l}"`).join(", ");
  return `import { headers, cookies } from "next/headers";
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
  try {
    const c = await cookies();
    const cookieLocale = c.get("NEXT_LOCALE")?.value;
    if (cookieLocale && supported.includes(cookieLocale as Locale)) {
      return cookieLocale as Locale;
    }
  } catch {}
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
