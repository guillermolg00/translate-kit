import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadTranslateKitConfig } from "./config.js";
import { runScanStep, runCodegenStep, runTranslateStep } from "./pipeline.js";
import {
  CLIENT_TEMPLATE,
  serverTemplate,
  generateI18nHelper,
} from "./templates/t-component.js";
import { parseFile } from "./scanner/parser.js";
import {
  createUsageTracker,
  estimateCost,
  formatUsage,
  formatCost,
} from "./usage.js";
import { validateLocale } from "./cli-utils.js";

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
  { value: "en", label: "English (en)" },
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

export function detectIncludePatterns(cwd: string): string[] {
  const patterns: string[] = [];
  const hasSrc = existsSync(join(cwd, "src"));

  // App router — prefer src/app over app
  if (hasSrc && existsSync(join(cwd, "src", "app"))) {
    patterns.push("src/app/**/*.tsx", "src/app/**/*.jsx");
  } else if (existsSync(join(cwd, "app"))) {
    patterns.push("app/**/*.tsx", "app/**/*.jsx");
  }

  // Pages router
  if (hasSrc && existsSync(join(cwd, "src", "pages"))) {
    patterns.push("src/pages/**/*.tsx", "src/pages/**/*.jsx");
  } else if (existsSync(join(cwd, "pages"))) {
    patterns.push("pages/**/*.tsx", "pages/**/*.jsx");
  }

  // Components
  if (hasSrc && existsSync(join(cwd, "src", "components"))) {
    patterns.push("src/components/**/*.tsx", "src/components/**/*.jsx");
  } else if (existsSync(join(cwd, "components"))) {
    patterns.push("components/**/*.tsx", "components/**/*.jsx");
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

export function generateConfigFile(opts: {
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
  splitByNamespace?: boolean;
  typeSafe?: boolean;
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
  if (opts.splitByNamespace) {
    lines.push(`  splitByNamespace: true,`);
  }
  if (opts.typeSafe) {
    lines.push(`  typeSafe: true,`);
  }

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
  lines.push(`    // Add more directories as needed. Examples:`);
  lines.push(`    // "config/**/*.ts"   — for data/config files (needed with --module-factory)`);
  lines.push(`    // "lib/**/*.ts"      — for utility files with translatable strings`);
  lines.push(`    // "layouts/**/*.tsx"  — for layout components`);
  lines.push(`    //`);
  lines.push(`    // Note: When using codegen --module-factory, include any directories`);
  lines.push(`    // that contain exported constants with translatable strings (e.g. config/).`);
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

function canParse(content: string, filePath: string): boolean {
  try {
    parseFile(content, filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeWriteModifiedFile(
  filePath: string,
  modified: string,
  label: string,
): Promise<boolean> {
  if (!canParse(modified, filePath)) {
    p.log.warn(
      `Could not safely modify ${label}. Please apply changes manually:\n` +
        `  File: ${filePath}`,
    );
    return false;
  }
  await writeFile(filePath, modified, "utf-8");
  return true;
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
  splitByNamespace?: boolean,
): Promise<void> {
  await mkdir(msgDir, { recursive: true });
  for (const locale of locales) {
    if (splitByNamespace) {
      await mkdir(join(msgDir, locale), { recursive: true });
    } else {
      const msgFile = join(msgDir, `${locale}.json`);
      if (!existsSync(msgFile)) {
        await writeFile(msgFile, "{}\n", "utf-8");
      }
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
  splitByNamespace?: boolean,
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

    const messagesLoader = splitByNamespace
      ? `await loadNamespaceMessages(join(process.cwd(), "${messagesDir}", locale))`
      : `(await import(\`${relMessages}/\${locale}.json\`)).default`;

    const splitHelpers = splitByNamespace
      ? `
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function loadNamespaceMessages(dir: string): Promise<Record<string, unknown>> {
  let files: string[];
  try { files = await readdir(dir); } catch { return {}; }
  const messages: Record<string, unknown> = {};
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const ns = file.replace(".json", "");
    if (ns === "_root") {
      Object.assign(messages, JSON.parse(await readFile(join(dir, file), "utf-8")));
    } else {
      messages[ns] = JSON.parse(await readFile(join(dir, file), "utf-8"));
    }
  }
  return messages;
}
`
      : "";

    await writeFile(
      requestFile,
      `import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";${splitHelpers}

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
    messages: ${messagesLoader},
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
      if (
        await safeWriteModifiedFile(nextConfigPath, updated, "next.config.ts")
      ) {
        filesCreated.push("next.config.ts (updated)");
      }
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

      if (
        await safeWriteModifiedFile(layoutPath, layoutContent, "root layout")
      ) {
        filesCreated.push(relative(cwd, layoutPath) + " (updated)");
      }
    }
  }

  await createEmptyMessageFiles(
    join(cwd, messagesDir),
    allLocales,
    splitByNamespace,
  );

  if (filesCreated.length > 0) {
    p.log.success(`next-intl configured: ${filesCreated.join(", ")}`);
  }
}

async function dropInlineComponents(
  cwd: string,
  componentPath: string,
  localeOpts: {
    sourceLocale: string;
    targetLocales: string[];
    messagesDir: string;
    splitByNamespace?: boolean;
  },
): Promise<void> {
  const fsPath = resolveComponentPath(cwd, componentPath);
  const dir = join(fsPath, "..");
  await mkdir(dir, { recursive: true });

  const clientFile = `${fsPath}.tsx`;
  const serverFile = `${fsPath}-server.tsx`;
  const clientBasename = basename(fsPath);

  await writeFile(clientFile, CLIENT_TEMPLATE, "utf-8");
  await writeFile(
    serverFile,
    serverTemplate(clientBasename, localeOpts),
    "utf-8",
  );

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
  splitByNamespace?: boolean,
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
      splitByNamespace,
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
        `import { setServerMessages, setLocale } from "${componentPath}-server";\n` +
        `import { getLocale, getMessages } from "@/i18n";\n`;

      layoutContent = insertImportsAfterLast(layoutContent, importLines);
      layoutContent = ensureAsyncLayout(layoutContent);

      layoutContent = layoutContent.replace(
        /return\s*\(/,
        "const locale = await getLocale();\n\tsetLocale(locale);\n\tconst messages = await getMessages(locale);\n\tsetServerMessages(messages);\n\n\treturn (",
      );

      layoutContent = layoutContent.replace(
        /(<body[^>]*>)/,
        "$1\n\t\t\t\t<I18nProvider messages={messages} locale={locale}>",
      );
      layoutContent = layoutContent.replace(
        /<\/body>/,
        "\t</I18nProvider>\n\t\t\t</body>",
      );

      if (
        await safeWriteModifiedFile(layoutPath, layoutContent, "root layout")
      ) {
        filesCreated.push(relative(cwd, layoutPath) + " (updated)");
      }
    }
  }

  await createEmptyMessageFiles(
    join(cwd, messagesDir),
    [sourceLocale, ...targetLocales],
    splitByNamespace,
  );

  if (filesCreated.length > 0) {
    p.log.success(`Inline i18n configured: ${filesCreated.join(", ")}`);
  }
}

export async function updateLayoutWithSelectiveMessages(
  cwd: string,
  clientNamespaces: string[],
): Promise<void> {
  if (clientNamespaces.length === 0) return;

  const useSrc = detectSrcDir(cwd);
  const base = useSrc ? join(cwd, "src") : cwd;
  const layoutPath = findLayoutFile(base);
  if (!layoutPath) return;

  let content = await readFile(layoutPath, "utf-8");

  const isNextIntl = content.includes("NextIntlClientProvider");
  const isInline = content.includes("I18nProvider") && !isNextIntl;

  if (!isNextIntl && !isInline) return;

  const namespacesStr = clientNamespaces.map((n) => `"${n}"`).join(", ");

  if (content.includes("clientMessages")) {
    // Already updated — just refresh the namespace list
    content = content.replace(
      /pickMessages\(messages,\s*\[.*?\]\)/,
      `pickMessages(messages, [${namespacesStr}])`,
    );
  } else {
    if (!content.includes("messages={messages}")) return;

    // Add pickMessages helper — different filter logic for inline vs keys mode
    if (!content.includes("pickMessages")) {
      const helper = isInline
        ? '\nfunction pickMessages(messages: Record<string, string>, namespaces: string[]) {\n  return Object.fromEntries(\n    Object.entries(messages).filter(([key]) =>\n      namespaces.some(ns => key === ns || key.startsWith(ns + "."))\n    )\n  );\n}\n'
        : '\nfunction pickMessages(messages: Record<string, unknown>, namespaces: string[]) {\n  return Object.fromEntries(Object.entries(messages).filter(([key]) => namespaces.includes(key) || (typeof messages[key] === "string" && namespaces.some(ns => key.startsWith(ns + ".")))));\n}\n';
      content = insertImportsAfterLast(content, helper);
    }

    // Insert clientMessages after getMessages() — handle both signatures
    content = content.replace(
      /const messages = await getMessages\([^)]*\);/,
      `$&\n  const clientMessages = pickMessages(messages, [${namespacesStr}]);`,
    );

    // Replace messages={messages} with messages={clientMessages}
    content = content.replace(
      "messages={messages}",
      "messages={clientMessages}",
    );
  }

  if (
    await safeWriteModifiedFile(
      layoutPath,
      content,
      "root layout (selective messages)",
    )
  ) {
    const rel = relative(cwd, layoutPath);
    p.log.success(
      `Updated ${rel} with selective message passing (${clientNamespaces.length} namespaces)`,
    );
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
      {
        value: "keys" as const,
        label: "Keys mode",
        hint: "t('key') + JSON files",
      },
      {
        value: "inline" as const,
        label: "Inline mode",
        hint: "<T id='key'>text</T>, text stays in code",
      },
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
    validate(value = "") {
      if (!validateLocale(value)) {
        return "Invalid locale. Use only letters, numbers, hyphens, and underscores.";
      }
    },
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

  let splitByNamespace = false;
  {
    const split = await p.confirm({
      message:
        "Split messages by namespace? (messages/en/hero.json instead of en.json)",
      initialValue: false,
    });
    if (p.isCancel(split)) cancel();
    splitByNamespace = split;
  }

  const detected = detectIncludePatterns(cwd);

  const patternsInput = await p.text({
    message: "Include patterns (comma-separated):",
    initialValue: detected.join(", "),
    placeholder: "app/**/*.tsx, components/**/*.tsx",
  });
  if (p.isCancel(patternsInput)) cancel();
  const includePatterns = patternsInput.split(",").map((s) => s.trim());

  let i18nImport = "";
  let componentPath: string | undefined;
  let typeSafe = false;

  if (mode === "inline") {
    const cp = await p.text({
      message: "Component import path:",
      initialValue: "@/components/t",
    });
    if (p.isCancel(cp)) cancel();
    componentPath = cp;
  } else {
    i18nImport = "next-intl";

    const ts = await p.confirm({
      message: "Generate TypeScript types for message keys? (next-intl.d.ts)",
      initialValue: true,
    });
    if (p.isCancel(ts)) cancel();
    typeSafe = ts;
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

  if (mode !== "inline") {
    await ensurePackageInstalled(cwd, "next-intl", "next-intl");
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
    splitByNamespace,
    typeSafe,
  });

  await writeFile(configPath, configContent, "utf-8");
  p.log.success("Created translate-kit.config.ts");

  if (mode === "inline" && componentPath) {
    await dropInlineComponents(cwd, componentPath, {
      sourceLocale,
      targetLocales,
      messagesDir,
      splitByNamespace,
    });
    await setupInlineI18n(
      cwd,
      componentPath,
      sourceLocale,
      targetLocales,
      messagesDir,
      splitByNamespace,
    );
  } else {
    await setupNextIntl(
      cwd,
      sourceLocale,
      targetLocales,
      messagesDir,
      splitByNamespace,
    );
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

  const usageTracker = createUsageTracker();

  // --- SCAN ---
  const s1 = p.spinner();
  s1.start("Scanning...");
  const scanResult = await runScanStep({
    config,
    cwd,
    callbacks: {
      onScanProgress: (c, t) => s1.message(`Scanning... ${c}/${t} files`),
      onKeygenProgress: (c, t) => s1.message(`Generating keys... ${c}/${t}`),
      onUsage: (usage) => usageTracker.add(usage),
    },
  });
  s1.stop(
    `Found ${scanResult.bareStringCount} strings from ${scanResult.fileCount} files`,
  );

  if (scanResult.bareStringCount === 0) {
    p.log.warn("No translatable strings found. Check your include patterns.");
    p.outro("Config created, but no strings to process.");
    return;
  }

  // --- CODEGEN ---
  const s3 = p.spinner();
  s3.start("Codegen...");
  const codegenResult = await runCodegenStep({
    config,
    cwd,
    textToKey: scanResult.textToKey,
    callbacks: {
      onProgress: (c, t) => s3.message(`Codegen... ${c}/${t} files`),
    },
  });
  s3.stop(
    `Codegen... ${codegenResult.stringsWrapped} strings wrapped in ${codegenResult.filesModified} files`,
  );

  // Update layout with selective message passing if client namespaces were found
  if (codegenResult.clientNamespaces.length > 0) {
    await updateLayoutWithSelectiveMessages(
      cwd,
      codegenResult.clientNamespaces,
    );
  }

  // --- TRANSLATE ---
  for (const locale of targetLocales) {
    const st = p.spinner();
    st.start(`Translating ${locale}...`);

    await runTranslateStep({
      config,
      sourceFlat: scanResult.sourceFlat,
      locales: [locale],
      callbacks: {
        onLocaleProgress: (_locale, c, t) =>
          st.message(`Translating ${locale}... ${c}/${t} keys`),
        onUsage: (usage) => usageTracker.add(usage),
      },
    });

    st.stop(`Translating ${locale}... done`);
  }

  const usage = usageTracker.get();
  if (usage.totalTokens > 0) {
    const cost = await estimateCost(config.model, usage);
    const costStr = cost ? ` · ${formatCost(cost.totalUSD)}` : "";
    p.log.info(`${formatUsage(usage)}${costStr}`);
  }

  p.outro("You're all set!");
}
