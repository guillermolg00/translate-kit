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
}): string {
  const provider = AI_PROVIDERS[opts.providerKey];
  const lines: string[] = [];

  lines.push(`import { ${provider.fn} } from "${provider.pkg}";`);
  lines.push(``);
  lines.push(`export default {`);
  lines.push(`  model: ${provider.fn}("${opts.modelName}"),`);
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
  if (opts.i18nImport) {
    lines.push(`    i18nImport: "${opts.i18nImport}",`);
  }
  lines.push(`  },`);

  lines.push(`};`);
  lines.push(``);

  return lines.join("\n");
}

// --- next-intl setup ---

function detectSrcDir(cwd: string): boolean {
  return existsSync(join(cwd, "src", "app"));
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

  // 1. Create i18n/request.ts
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

  // 2. Wrap next.config.ts with createNextIntlPlugin
  const nextConfigPath = join(cwd, "next.config.ts");
  if (existsSync(nextConfigPath)) {
    const content = await readFile(nextConfigPath, "utf-8");
    if (!content.includes("next-intl")) {
      const importLine = `import createNextIntlPlugin from "next-intl/plugin";\n`;
      const pluginLine = `const withNextIntl = createNextIntlPlugin();\n`;

      // Replace `export default <expr>;` → `export default withNextIntl(<expr>);`
      const wrapped = content.replace(
        /export default (.+);/,
        "export default withNextIntl($1);",
      );

      const updated = importLine + "\n" + pluginLine + "\n" + wrapped;
      await writeFile(nextConfigPath, updated, "utf-8");
      filesCreated.push("next.config.ts (updated)");
    }
  }

  // 3. Add NextIntlClientProvider to root layout
  const layoutExts = ["tsx", "jsx", "ts", "js"];
  let layoutPath: string | undefined;
  for (const ext of layoutExts) {
    const candidate = join(base, "app", `layout.${ext}`);
    if (existsSync(candidate)) {
      layoutPath = candidate;
      break;
    }
  }

  if (layoutPath) {
    let layoutContent = await readFile(layoutPath, "utf-8");
    if (!layoutContent.includes("NextIntlClientProvider")) {
      const importLines =
        'import { NextIntlClientProvider } from "next-intl";\n' +
        'import { getMessages } from "next-intl/server";\n';

      const lastImportIdx = layoutContent.lastIndexOf("import ");
      const endOfLastImport = layoutContent.indexOf("\n", lastImportIdx);
      layoutContent =
        layoutContent.slice(0, endOfLastImport + 1) +
        importLines +
        layoutContent.slice(endOfLastImport + 1);

      // Ensure the layout function is async
      if (!layoutContent.match(/async\s+function\s+\w*Layout/)) {
        layoutContent = layoutContent.replace(
          /export\s+default\s+function\s+(\w*Layout)/,
          "export default async function $1",
        );
      }

      layoutContent = layoutContent.replace(
        /return\s*\(/,
        "const messages = await getMessages();\n\n  return (",
      );

      // Wrap entire body content so all components (Navbar, Footer, etc.) have access
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

  // 4. Create empty message files
  const msgDir = join(cwd, messagesDir);
  await mkdir(msgDir, { recursive: true });
  for (const locale of allLocales) {
    const msgFile = join(msgDir, `${locale}.json`);
    if (!existsSync(msgFile)) {
      await writeFile(msgFile, "{}\n", "utf-8");
    }
  }

  if (filesCreated.length > 0) {
    p.log.success(`next-intl configured: ${filesCreated.join(", ")}`);
  }
}

// --- Main wizard ---

export async function runInitWizard(): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, "translate-kit.config.ts");

  p.intro("translate-kit setup");

  // Check existing config
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

  // 1. AI Provider
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

  // 2. Model name
  const modelName = await p.text({
    message: "Model:",
    initialValue: provider.defaultModel,
  });
  if (p.isCancel(modelName)) cancel();

  // 3. Source locale
  const sourceLocale = await p.text({
    message: "Source locale:",
    initialValue: "en",
  });
  if (p.isCancel(sourceLocale)) cancel();

  // 4. Target locales
  const targetLocales = await p.multiselect({
    message: "Target locales:",
    options: LOCALE_OPTIONS.filter((o) => o.value !== sourceLocale),
    required: true,
  });
  if (p.isCancel(targetLocales)) cancel();

  // 5. Messages directory
  const messagesDir = await p.text({
    message: "Messages directory:",
    initialValue: "./messages",
  });
  if (p.isCancel(messagesDir)) cancel();

  // 6. Include patterns (auto-detect)
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

  // 7. i18n library
  const i18nImport = await p.text({
    message: "i18n library:",
    initialValue: "next-intl",
  });
  if (p.isCancel(i18nImport)) cancel();

  // 8. Project context
  const context = await p.text({
    message: "Project context (optional, for better translations):",
    placeholder: "e.g. E-commerce platform, SaaS dashboard",
  });
  if (p.isCancel(context)) cancel();

  // 9. Tone
  const tone = await p.select({
    message: "Tone:",
    options: [
      { value: "neutral", label: "Neutral" },
      { value: "formal", label: "Formal" },
      { value: "casual", label: "Casual" },
    ],
  });
  if (p.isCancel(tone)) cancel();

  // --- Verify dependencies before proceeding ---

  // Check AI provider
  await ensurePackageInstalled(cwd, provider.pkg, "AI provider");

  // Check i18n library
  if (i18nImport) {
    await ensurePackageInstalled(cwd, i18nImport, "i18n library");
  }

  // --- Write config ---

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
  });

  await writeFile(configPath, configContent, "utf-8");
  p.log.success("Created translate-kit.config.ts");

  // --- Setup i18n library ---

  if (i18nImport === "next-intl") {
    await setupNextIntl(cwd, sourceLocale, targetLocales, messagesDir);
  }

  // Ask to run pipeline
  const runPipeline = await p.confirm({
    message: "Run the full pipeline now?",
  });
  if (p.isCancel(runPipeline)) cancel();

  if (!runPipeline) {
    p.outro("You're all set! Run translate-kit scan when ready.");
    return;
  }

  // Load config via c12/jiti
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

  // Step 1: Scan
  const s1 = p.spinner();
  s1.start("Scanning...");
  const scanResult = await scan(scanOptions, cwd);
  const bareStrings = scanResult.strings.filter((s) => s.type !== "t-call");
  // Only keep types that codegen can transform
  const transformableStrings = bareStrings.filter(
    (s) =>
      s.type === "jsx-text" ||
      s.type === "jsx-attribute" ||
      s.type === "object-property",
  );
  s1.stop(
    `Scanning... ${bareStrings.length} strings from ${scanResult.fileCount} files`,
  );

  if (transformableStrings.length === 0) {
    p.log.warn("No translatable strings found. Check your include patterns.");
    p.outro("Config created, but no strings to process.");
    return;
  }

  // Step 2: Generate keys (preserving existing map for idempotency)
  const resolvedMessagesDir = join(cwd, messagesDir);
  await mkdir(resolvedMessagesDir, { recursive: true });

  let existingMap: Record<string, string> = {};
  const mapPath = join(resolvedMessagesDir, ".translate-map.json");
  if (existsSync(mapPath)) {
    try {
      existingMap = JSON.parse(await readFile(mapPath, "utf-8"));
    } catch {}
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

  // Step 3: Write map and source messages
  await writeFile(
    mapPath,
    JSON.stringify(textToKey, null, 2) + "\n",
    "utf-8",
  );

  const messages: Record<string, string> = {};
  for (const [text, key] of Object.entries(textToKey)) {
    messages[key] = text;
  }

  const sourceFile = join(resolvedMessagesDir, `${sourceLocale}.json`);
  const nested = unflatten(messages);
  await writeFile(
    sourceFile,
    JSON.stringify(nested, null, 2) + "\n",
    "utf-8",
  );

  // Step 4: Codegen
  const s3 = p.spinner();
  s3.start("Codegen...");
  const codegenResult = await codegen(
    {
      include: includePatterns,
      exclude: ["**/*.test.*", "**/*.spec.*"],
      textToKey,
      i18nImport,
    },
    cwd,
  );
  s3.stop(
    `Codegen... ${codegenResult.stringsWrapped} strings wrapped in ${codegenResult.filesModified} files`,
  );

  // Step 5: Reconcile en.json — only keep keys that codegen actually wrapped
  const postScan = await scan(scanOptions, cwd);
  const tCalls = postScan.strings.filter((s) => s.type === "t-call");

  const keyToText: Record<string, string> = {};
  for (const [text, key] of Object.entries(textToKey)) {
    keyToText[key] = text;
  }

  const reconciledMessages: Record<string, string> = {};
  for (const tCall of tCalls) {
    const key = tCall.text;
    if (key in keyToText) {
      reconciledMessages[key] = keyToText[key];
    }
  }

  const reconciledNested = unflatten(reconciledMessages);
  await writeFile(
    sourceFile,
    JSON.stringify(reconciledNested, null, 2) + "\n",
    "utf-8",
  );

  // Step 6: Translate each target locale
  const translationOpts = config.translation ?? {};
  const sourceFlat = reconciledMessages;

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
    await writeTranslation(targetFile, translated);

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
