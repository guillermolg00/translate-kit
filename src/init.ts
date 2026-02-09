import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadTranslateKitConfig } from "./config.js";
import { scan } from "./scanner/index.js";
import { generateSemanticKeys } from "./scanner/key-ai.js";
import { codegen } from "./codegen/index.js";
import { translateAll } from "./translate.js";
import { writeTranslation, writeLockFile } from "./writer.js";
import { loadLockFile } from "./diff.js";
import { unflatten } from "./flatten.js";
import { CLIENT_TEMPLATE, SERVER_TEMPLATE, generateI18nHelper } from "./templates/t-component.js";

const AI_PROVIDERS = {
  openai: {
    pkg: "@ai-sdk/openai",
    fn: "openai",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    pkg: "@ai-sdk/anthropic",
    fn: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
  },
  google: {
    pkg: "@ai-sdk/google",
    fn: "google",
    defaultModel: "gemini-2.0-flash",
  },
  mistral: {
    pkg: "@ai-sdk/mistral",
    fn: "mistral",
    defaultModel: "mistral-large-latest",
  },
  groq: {
    pkg: "@ai-sdk/groq",
    fn: "groq",
    defaultModel: "llama-3.3-70b-versatile",
  },
} as const;

type ProviderKey = keyof typeof AI_PROVIDERS;

const LOCALE_OPTIONS = [
  { value: "es", label: "Spanish (es)" },
  { value: "fr", label: "French (fr)" },
  { value: "de", label: "German (de)" },
  { value: "pt", label: "Portuguese (pt)" },
  { value: "ja", label: "Japanese (ja)" },
  { value: "zh", label: "Chinese (zh)" },
  { value: "ko", label: "Korean (ko)" },
  { value: "ru", label: "Russian (ru)" },
  { value: "ar", label: "Arabic (ar)" },
  { value: "it", label: "Italian (it)" },
];

function detectIncludePatterns(cwd: string): string[] {
  const patterns: string[] = [];
  if (existsSync(join(cwd, "app")))
    patterns.push("app/**/*.tsx", "app/**/*.jsx");
  if (existsSync(join(cwd, "src")))
    patterns.push("src/**/*.tsx", "src/**/*.jsx");
  if (existsSync(join(cwd, "pages")))
    patterns.push("pages/**/*.tsx", "pages/**/*.jsx");
  if (existsSync(join(cwd, "src", "app"))) {
    return patterns.filter((p) => !p.startsWith("app/"));
  }
  return patterns.length > 0 ? patterns : ["**/*.tsx", "**/*.jsx"];
}

function cancel(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

function findPackageInNodeModules(cwd: string, pkg: string): boolean {
  let dir = cwd;
  const parts = pkg.split("/");
  while (true) {
    if (existsSync(join(dir, "node_modules", ...parts, "package.json"))) {
      return true;
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

async function ensurePackageInstalled(
  cwd: string,
  pkg: string,
  label: string,
): Promise<void> {
  while (!findPackageInNodeModules(cwd, pkg)) {
    p.log.warn(`${label} (${pkg}) is not installed.`);
    const retry = await p.confirm({
      message: `Install it now with your package manager, then press Enter. Continue?`,
    });
    if (p.isCancel(retry) || !retry) cancel();
  }
  p.log.success(`${label} found.`);
}

function generateConfigFile(opts: {
  providerKey: ProviderKey;
  modelName: string;
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  includePatterns: string[];
  i18nImport: string;
  context: string;
  tone: string;
  mode: "keys" | "inline";
  componentPath?: string;
}): string {
  const provider = AI_PROVIDERS[opts.providerKey];
  const lines: string[] = [];

  lines.push(`import { ${provider.fn} } from "${provider.pkg}";`);
  lines.push(``);
  lines.push(`export default {`);
  lines.push(`  model: ${provider.fn}("${opts.modelName}"),`);
  if (opts.mode === "inline") {
    lines.push(`  mode: "inline",`);
  }
  lines.push(`  sourceLocale: "${opts.sourceLocale}",`);
  lines.push(
    `  targetLocales: [${opts.targetLocales.map((l) => `"${l}"`).join(", ")}],`,
  );
  lines.push(`  messagesDir: "${opts.messagesDir}",`);

  const hasTranslation = opts.context || opts.tone !== "neutral";
  if (hasTranslation) {
    lines.push(`  translation: {`);
    if (opts.context) {
      lines.push(`    context: "${opts.context}",`);
    }
    if (opts.tone !== "neutral") {
      lines.push(`    tone: "${opts.tone}",`);
    }
    lines.push(`  },`);
  }

  lines.push(`  scan: {`);
  lines.push(
    `    include: [${opts.includePatterns.map((p) => `"${p}"`).join(", ")}],`,
  );
  lines.push(`    exclude: ["**/*.test.*", "**/*.spec.*"],`);
  if (opts.mode === "keys" && opts.i18nImport) {
    lines.push(`    i18nImport: "${opts.i18nImport}",`);
  }
  lines.push(`  },`);

  if (opts.mode === "inline" && opts.componentPath) {
    lines.push(`  inline: {`);
    lines.push(`    componentPath: "${opts.componentPath}",`);
    lines.push(`  },`);
  }

  lines.push(`};`);
  lines.push(``);

  return lines.join("\n");
}

function detectSrcDir(cwd: string): boolean {
  return existsSync(join(cwd, "src", "app"));
}

function resolveComponentPath(cwd: string, componentPath: string): string {
  if (componentPath.startsWith("@/")) {
    const rel = componentPath.slice(2);
    const useSrc = existsSync(join(cwd, "src"));
    return join(cwd, useSrc ? "src" : "", rel);
  }
  if (componentPath.startsWith("~/")) {
    return join(cwd, componentPath.slice(2));
  }
  return join(cwd, componentPath);
}

function findLayoutFile(base: string): string | undefined {
  for (const ext of ["tsx", "jsx", "ts", "js"]) {
    const candidate = join(base, "app", `layout.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function createEmptyMessageFiles(
  msgDir: string,
  locales: string[],
): Promise<void> {
  await mkdir(msgDir, { recursive: true });
  for (const locale of locales) {
    const msgFile = join(msgDir, `${locale}.json`);
    if (!existsSync(msgFile)) {
      await writeFile(msgFile, "{}\n", "utf-8");
    }
  }
}

function insertImportsAfterLast(content: string, importLines: string): string {
  const lastImportIdx = content.lastIndexOf("import ");
  const endOfLastImport = content.indexOf("\n", lastImportIdx);
  return (
    content.slice(0, endOfLastImport + 1) +
    importLines +
    content.slice(endOfLastImport + 1)
  );
}

function ensureAsyncLayout(content: string): string {
  if (content.match(/async\s+function\s+\w*Layout/)) return content;
  return content.replace(
    /export\s+default\s+function\s+(\w*Layout)/,
    "export default async function $1",
  );
}

async function setupNextIntl(
  cwd: string,
  sourceLocale: string,
  targetLocales: string[],
  messagesDir: string,
): Promise<void> {
  const useSrc = detectSrcDir(cwd);
  const base = useSrc ? join(cwd, "src") : cwd;
  const allLocales = [sourceLocale, ...targetLocales];
  const filesCreated: string[] = [];

  const i18nDir = join(base, "i18n");
  await mkdir(i18nDir, { recursive: true });

  const requestFile = join(i18nDir, "request.ts");
  if (!existsSync(requestFile)) {
    const relMessages = relative(i18nDir, join(cwd, messagesDir));
    const allLocalesStr = allLocales.map((l) => `"${l}"`).join(", ");
    await writeFile(
      requestFile,
      `import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";

const supported = [${allLocalesStr}] as const;
type Locale = (typeof supported)[number];
const defaultLocale: Locale = "${sourceLocale}";

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

export default getRequestConfig(async () => {
  const h = await headers();
  const acceptLang = h.get("accept-language") ?? "";
  const locale = parseAcceptLanguage(acceptLang);

  return {
    locale,
    messages: (await import(\`${relMessages}/\${locale}.json\`)).default,
  };
});
`,
      "utf-8",
    );
    filesCreated.push(relative(cwd, requestFile));
  }

  const nextConfigPath = join(cwd, "next.config.ts");
  if (existsSync(nextConfigPath)) {
    const content = await readFile(nextConfigPath, "utf-8");
    if (!content.includes("next-intl")) {
      const importLine = `import createNextIntlPlugin from "next-intl/plugin";\n`;
      const pluginLine = `const withNextIntl = createNextIntlPlugin();\n`;

      const wrapped = content.replace(
        /export default (.+?);/,
        "export default withNextIntl($1);",
      );

      const updated = importLine + "\n" + pluginLine + "\n" + wrapped;
      await writeFile(nextConfigPath, updated, "utf-8");
      filesCreated.push("next.config.ts (updated)");
    }
  }

  const layoutPath = findLayoutFile(base);

  if (layoutPath) {
    let layoutContent = await readFile(layoutPath, "utf-8");
    if (!layoutContent.includes("NextIntlClientProvider")) {
      const importLines =
        'import { NextIntlClientProvider } from "next-intl";\n' +
        'import { getMessages } from "next-intl/server";\n';

      layoutContent = insertImportsAfterLast(layoutContent, importLines);
      layoutContent = ensureAsyncLayout(layoutContent);

      layoutContent = layoutContent.replace(
        /return\s*\(/,
        "const messages = await getMessages();\n\n  return (",
      );

      layoutContent = layoutContent.replace(
        /(<body[^>]*>)/,
        "$1\n        <NextIntlClientProvider messages={messages}>",
      );
      layoutContent = layoutContent.replace(
        /<\/body>/,
        "  </NextIntlClientProvider>\n      </body>",
      );

      await writeFile(layoutPath, layoutContent, "utf-8");
      filesCreated.push(relative(cwd, layoutPath) + " (updated)");
    }
  }

  await createEmptyMessageFiles(
    join(cwd, messagesDir),
    allLocales,
  );

  if (filesCreated.length > 0) {
    p.log.success(`next-intl configured: ${filesCreated.join(", ")}`);
  }
}

async function dropInlineComponents(
  cwd: string,
  componentPath: string,
): Promise<void> {
  const fsPath = resolveComponentPath(cwd, componentPath);
  const dir = join(fsPath, "..");
  await mkdir(dir, { recursive: true });

  const clientFile = `${fsPath}.tsx`;
  const serverFile = `${fsPath}-server.tsx`;

  await writeFile(clientFile, CLIENT_TEMPLATE, "utf-8");
  await writeFile(serverFile, SERVER_TEMPLATE, "utf-8");

  const relClient = relative(cwd, clientFile);
  const relServer = relative(cwd, serverFile);
  p.log.success(`Created inline components: ${relClient}, ${relServer}`);
}

async function setupInlineI18n(
  cwd: string,
  componentPath: string,
  sourceLocale: string,
  targetLocales: string[],
  messagesDir: string,
): Promise<void> {
  const useSrc = existsSync(join(cwd, "src"));
  const base = useSrc ? join(cwd, "src") : cwd;
  const filesCreated: string[] = [];

  const i18nDir = join(base, "i18n");
  await mkdir(i18nDir, { recursive: true });

  const helperFile = join(i18nDir, "index.ts");
  if (!existsSync(helperFile)) {
    const helperContent = generateI18nHelper({
      sourceLocale,
      targetLocales,
      messagesDir,
    });
    await writeFile(helperFile, helperContent, "utf-8");
    filesCreated.push(relative(cwd, helperFile));
  }

  const layoutPath = findLayoutFile(base);

  if (layoutPath) {
    let layoutContent = await readFile(layoutPath, "utf-8");
    if (!layoutContent.includes("I18nProvider")) {
      const importLines =
        `import { I18nProvider } from "${componentPath}";\n` +
        `import { getLocale, getMessages } from "@/i18n";\n`;

      layoutContent = insertImportsAfterLast(layoutContent, importLines);
      layoutContent = ensureAsyncLayout(layoutContent);

      layoutContent = layoutContent.replace(
        /return\s*\(/,
        "const locale = await getLocale();\n\tconst messages = await getMessages(locale);\n\n\treturn (",
      );

      layoutContent = layoutContent.replace(
        /(<body[^>]*>)/,
        "$1\n\t\t\t\t<I18nProvider messages={messages}>",
      );
      layoutContent = layoutContent.replace(
        /<\/body>/,
        "\t</I18nProvider>\n\t\t\t</body>",
      );

      await writeFile(layoutPath, layoutContent, "utf-8");
      filesCreated.push(relative(cwd, layoutPath) + " (updated)");
    }
  }

  await createEmptyMessageFiles(
    join(cwd, messagesDir),
    [sourceLocale, ...targetLocales],
  );

  if (filesCreated.length > 0) {
    p.log.success(`Inline i18n configured: ${filesCreated.join(", ")}`);
  }
}

// --- Main wizard ---

export async function runInitWizard(): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, "translate-kit.config.ts");

  p.intro("translate-kit setup");

  if (existsSync(configPath)) {
    const overwrite = await p.confirm({
      message: "translate-kit.config.ts already exists. Overwrite?",
    });
    if (p.isCancel(overwrite)) cancel();
    if (!overwrite) {
      p.outro("Keeping existing config.");
      return;
    }
  }

  const mode = await p.select({
    message: "Translation mode:",
    options: [
      { value: "keys" as const, label: "Keys mode", hint: "t('key') + JSON files" },
      { value: "inline" as const, label: "Inline mode", hint: "<T id='key'>text</T>, text stays in code" },
    ],
  });
  if (p.isCancel(mode)) cancel();

  const providerKey = await p.select({
    message: "AI provider:",
    options: Object.entries(AI_PROVIDERS).map(([key, val]) => ({
      value: key as ProviderKey,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      hint: val.pkg,
    })),
  });
  if (p.isCancel(providerKey)) cancel();

  const provider = AI_PROVIDERS[providerKey];

  const modelName = await p.text({
    message: "Model:",
    initialValue: provider.defaultModel,
  });
  if (p.isCancel(modelName)) cancel();

  const sourceLocale = await p.text({
    message: "Source locale:",
    initialValue: "en",
  });
  if (p.isCancel(sourceLocale)) cancel();

  const targetLocales = await p.multiselect({
    message: "Target locales:",
    options: LOCALE_OPTIONS.filter((o) => o.value !== sourceLocale),
    required: true,
  });
  if (p.isCancel(targetLocales)) cancel();

  const messagesDir = await p.text({
    message: "Messages directory:",
    initialValue: "./messages",
  });
  if (p.isCancel(messagesDir)) cancel();

  const detected = detectIncludePatterns(cwd);
  let includePatterns: string[];

  const useDetected = await p.confirm({
    message: `Detected: ${detected.join(", ")} — Use these patterns?`,
  });
  if (p.isCancel(useDetected)) cancel();

  if (useDetected) {
    includePatterns = detected;
  } else {
    const customPatterns = await p.text({
      message: "Include patterns (comma-separated):",
      initialValue: "src/**/*.tsx, src/**/*.jsx",
    });
    if (p.isCancel(customPatterns)) cancel();
    includePatterns = customPatterns.split(",").map((s) => s.trim());
  }

  let i18nImport = "";
  let componentPath: string | undefined;

  if (mode === "inline") {
    const cp = await p.text({
      message: "Component import path:",
      initialValue: "@/components/t",
    });
    if (p.isCancel(cp)) cancel();
    componentPath = cp;
  } else {
    const lib = await p.text({
      message: "i18n library:",
      initialValue: "next-intl",
    });
    if (p.isCancel(lib)) cancel();
    i18nImport = lib;
  }

  const context = await p.text({
    message: "Project context (optional, for better translations):",
    placeholder: "e.g. E-commerce platform, SaaS dashboard",
  });
  if (p.isCancel(context)) cancel();

  const tone = await p.select({
    message: "Tone:",
    options: [
      { value: "neutral", label: "Neutral" },
      { value: "formal", label: "Formal" },
      { value: "casual", label: "Casual" },
    ],
  });
  if (p.isCancel(tone)) cancel();

  await ensurePackageInstalled(cwd, provider.pkg, "AI provider");

  if (i18nImport) {
    await ensurePackageInstalled(cwd, i18nImport, "i18n library");
  }

  const configContent = generateConfigFile({
    providerKey,
    modelName,
    sourceLocale,
    targetLocales,
    messagesDir,
    includePatterns,
    i18nImport,
    context: context ?? "",
    tone,
    mode,
    componentPath,
  });

  await writeFile(configPath, configContent, "utf-8");
  p.log.success("Created translate-kit.config.ts");

  if (mode === "inline" && componentPath) {
    await dropInlineComponents(cwd, componentPath);
    await setupInlineI18n(cwd, componentPath, sourceLocale, targetLocales, messagesDir);
  } else if (i18nImport === "next-intl") {
    await setupNextIntl(cwd, sourceLocale, targetLocales, messagesDir);
  }

  const runPipeline = await p.confirm({
    message: "Run the full pipeline now?",
  });
  if (p.isCancel(runPipeline)) cancel();

  if (!runPipeline) {
    p.outro("You're all set! Run translate-kit scan when ready.");
    return;
  }

  let config;
  try {
    config = await loadTranslateKitConfig();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    p.log.error(`Failed to load config: ${errMsg}`);
    p.outro("Config created but pipeline skipped.");
    return;
  }

  const { model } = config;

  const scanOptions = {
    include: includePatterns,
    exclude: ["**/*.test.*", "**/*.spec.*"],
    i18nImport,
  };

  const s1 = p.spinner();
  s1.start("Scanning...");
  const scanResult = await scan(scanOptions, cwd);
  const transformableStrings = scanResult.strings.filter(
    (s) =>
      s.type === "jsx-text" ||
      s.type === "jsx-attribute" ||
      s.type === "object-property",
  );
  s1.stop(
    `Scanning... ${transformableStrings.length} strings from ${scanResult.fileCount} files`,
  );

  if (transformableStrings.length === 0) {
    p.log.warn("No translatable strings found. Check your include patterns.");
    p.outro("Config created, but no strings to process.");
    return;
  }

  const resolvedMessagesDir = join(cwd, messagesDir);
  await mkdir(resolvedMessagesDir, { recursive: true });

  let existingMap: Record<string, string> = {};
  const mapPath = join(resolvedMessagesDir, ".translate-map.json");
  try {
    existingMap = JSON.parse(await readFile(mapPath, "utf-8"));
  } catch {
    // No existing map file — fresh start
  }

  const s2 = p.spinner();
  s2.start("Generating keys...");
  const textToKey = await generateSemanticKeys({
    model,
    strings: transformableStrings,
    existingMap,
    batchSize: config.translation?.batchSize ?? 50,
    concurrency: config.translation?.concurrency ?? 3,
    retries: config.translation?.retries ?? 2,
  });
  s2.stop("Generating keys... done");

  await writeFile(mapPath, JSON.stringify(textToKey, null, 2) + "\n", "utf-8");

  const messages: Record<string, string> = {};
  for (const [text, key] of Object.entries(textToKey)) {
    messages[key] = text;
  }

  let sourceFlat: Record<string, string>;

  if (mode === "inline") {
    sourceFlat = messages;
  } else {
    const sourceFile = join(resolvedMessagesDir, `${sourceLocale}.json`);
    const nested = unflatten(messages);
    await writeFile(sourceFile, JSON.stringify(nested, null, 2) + "\n", "utf-8");
    sourceFlat = messages;
  }

  const s3 = p.spinner();
  s3.start("Codegen...");
  const codegenResult = await codegen(
    {
      include: includePatterns,
      exclude: ["**/*.test.*", "**/*.spec.*"],
      textToKey,
      i18nImport,
      mode,
      componentPath,
    },
    cwd,
  );
  s3.stop(
    `Codegen... ${codegenResult.stringsWrapped} strings wrapped in ${codegenResult.filesModified} files`,
  );

  const postScan = await scan(scanOptions, cwd);

  const keyToText: Record<string, string> = {};
  for (const [text, key] of Object.entries(textToKey)) {
    keyToText[key] = text;
  }

  const reconciledMessages: Record<string, string> = {};

  if (mode === "inline") {
    const tComponents = postScan.strings.filter((s) => s.type === "T-component" && s.id);
    const inlineTCalls = postScan.strings.filter((s) => s.type === "t-call" && s.id);
    for (const tc of tComponents) {
      if (tc.id && tc.id in keyToText) {
        reconciledMessages[tc.id] = keyToText[tc.id];
      }
    }
    for (const tc of inlineTCalls) {
      if (tc.id && tc.id in keyToText) {
        reconciledMessages[tc.id] = keyToText[tc.id];
      }
    }
  } else {
    const tCalls = postScan.strings.filter((s) => s.type === "t-call");
    for (const tCall of tCalls) {
      const key = tCall.text;
      if (key in keyToText) {
        reconciledMessages[key] = keyToText[key];
      }
    }

    const sourceFile = join(resolvedMessagesDir, `${sourceLocale}.json`);
    const reconciledNested = unflatten(reconciledMessages);
    await writeFile(
      sourceFile,
      JSON.stringify(reconciledNested, null, 2) + "\n",
      "utf-8",
    );
  }

  sourceFlat = reconciledMessages;

  const translationOpts = config.translation ?? {};

  for (const locale of targetLocales) {
    const st = p.spinner();
    st.start(`Translating ${locale}...`);

    const translated = await translateAll({
      model,
      entries: sourceFlat,
      sourceLocale,
      targetLocale: locale,
      options: translationOpts,
    });

    const targetFile = join(resolvedMessagesDir, `${locale}.json`);
    await writeTranslation(targetFile, translated, { flat: mode === "inline" });

    const lockData = await loadLockFile(resolvedMessagesDir);
    await writeLockFile(
      resolvedMessagesDir,
      sourceFlat,
      lockData,
      Object.keys(translated),
    );

    st.stop(`Translating ${locale}... done`);
  }

  p.outro("You're all set!");
}
