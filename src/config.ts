import { loadConfig } from "c12";
import { z } from "zod";
import type { TranslateKitConfig } from "./types.js";

const configSchema = z.object({
  model: z.custom<TranslateKitConfig["model"]>(
    (val) => val != null && typeof val === "object",
    { message: "model must be an AI SDK LanguageModel instance" },
  ),
  sourceLocale: z.string().min(1),
  targetLocales: z.array(z.string().min(1)).min(1),
  messagesDir: z.string().min(1),
  translation: z
    .object({
      batchSize: z.number().int().positive().default(50),
      context: z.string().optional(),
      glossary: z.record(z.string()).optional(),
      tone: z.string().optional(),
      retries: z.number().int().min(0).default(2),
      concurrency: z.number().int().positive().default(3),
    })
    .optional(),
  scan: z
    .object({
      include: z.array(z.string()),
      exclude: z.array(z.string()).optional(),
      keyStrategy: z.enum(["hash", "path"]).default("hash"),
      translatableProps: z
        .array(z.string())
        .default(["placeholder", "title", "alt", "aria-label"]),
      i18nImport: z.string().default("next-intl"),
    })
    .optional(),
});

export function defineConfig(config: TranslateKitConfig) {
  return config as TranslateKitConfig;
}

export async function loadTranslateKitConfig(): Promise<TranslateKitConfig> {
  const { config } = await loadConfig({
    name: "translate-kit",
  });

  if (!config || Object.keys(config).length === 0) {
    throw new Error(
      "No config found. Create a translate-kit.config.ts file or run `translate-kit init`.",
    );
  }

  const result = configSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config:\n${errors}`);
  }

  return result.data as TranslateKitConfig;
}
