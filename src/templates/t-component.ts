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

const SPLIT_LOAD_BODY = `  try {
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), messagesDir, locale);
    let files: string[];
    try { files = (await readdir(dir)).filter(f => f.endsWith(".json")); } catch { return {}; }
    const msgs: Messages = {};
    for (const f of files) {
      const ns = f.replace(".json", "");
      const data = JSON.parse(await readFile(join(dir, f), "utf-8"));
      (function flat(obj: any, prefix: string) {
        for (const [k, v] of Object.entries(obj)) {
          const full = prefix ? prefix + "." + k : k;
          if (typeof v === "object" && v !== null && !Array.isArray(v)) flat(v, full);
          else msgs[ns === "_root" ? full : ns + "." + full] = v as string;
        }
      })(data, "");
    }
    return msgs;
  } catch {
    return {};
  }`;

function buildSingleFileLoadBody(
  targetLocales: string[],
  relativeMessagesDir: string,
): string {
  // Generate static import() calls per locale — works on all platforms
  const cases = targetLocales
    .map(
      (locale) =>
        `      case "${locale}": return (await import("${relativeMessagesDir}/${locale}.json")).default;`,
    )
    .join("\n");

  return `  try {\n    switch (locale) {\n${cases}\n      default: return {};\n    }\n  } catch {\n    return {};\n  }`;
}

export function serverTemplate(
  clientBasename: string,
  opts?: {
    sourceLocale: string;
    targetLocales: string[];
    messagesDir: string;
    splitByNamespace?: boolean;
    relativeMessagesDir?: string;
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

  const isSplit = !!opts.splitByNamespace;
  // Compute the relative import path for messages directory
  let messagesImportPath = opts.relativeMessagesDir ?? opts.messagesDir;
  // Ensure it starts with ./ or ../ for relative imports
  if (!messagesImportPath.startsWith(".") && !messagesImportPath.startsWith("/")) {
    messagesImportPath = `./${messagesImportPath}`;
  }
  const loadBody = isSplit
    ? SPLIT_LOAD_BODY
    : buildSingleFileLoadBody(opts.targetLocales, messagesImportPath);
  // messagesDir const is only needed for split mode (filesystem loading)
  const messagesDirConst = isSplit
    ? `\nconst messagesDir = "${opts.messagesDir}";\n`
    : "\n";

  return `import type { ReactNode } from "react";
import { cache } from "react";
export { I18nProvider } from "./${clientBasename}";

type Messages = Record<string, string>;

const supported = [${allLocalesStr}] as const;
type Locale = (typeof supported)[number];
const defaultLocale: Locale = "${opts.sourceLocale}";${messagesDirConst}
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

// Per-request cached message loading — works on all platforms via static imports
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
${loadBody}
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
  splitByNamespace?: boolean;
}): string {
  const allLocales = [opts.sourceLocale, ...opts.targetLocales];
  const allLocalesStr = allLocales.map((l) => `"${l}"`).join(", ");

  const fsImports = opts.splitByNamespace
    ? `import { readFile, readdir } from "node:fs/promises";`
    : `import { readFile } from "node:fs/promises";`;

  const getMessagesBody = opts.splitByNamespace
    ? `  if (locale === defaultLocale) return {};
  try {
    const dir = join(process.cwd(), "${opts.messagesDir}", locale);
    let files: string[];
    try { files = (await readdir(dir)).filter(f => f.endsWith(".json")); } catch { return {}; }
    const msgs: Record<string, string> = {};
    for (const f of files) {
      const ns = f.replace(".json", "");
      const data = JSON.parse(await readFile(join(dir, f), "utf-8"));
      (function flat(obj: any, prefix: string) {
        for (const [k, v] of Object.entries(obj)) {
          const full = prefix ? prefix + "." + k : k;
          if (typeof v === "object" && v !== null && !Array.isArray(v)) flat(v, full);
          else msgs[ns === "_root" ? full : ns + "." + full] = v as string;
        }
      })(data, "");
    }
    return msgs;
  } catch {
    return {};
  }`
    : `  if (locale === defaultLocale) return {};
  try {
    const filePath = join(process.cwd(), "${opts.messagesDir}", \`\${locale}.json\`);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }`;

  return `import { headers, cookies } from "next/headers";
${fsImports}
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
${getMessagesBody}
}
`;
}
