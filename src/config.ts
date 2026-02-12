import { loadConfig } from "c12";
import { z } from "zod";
import type { TranslateKitConfig } from "./types.js";
import { DEFAULT_TRANSLATABLE_PROPS } from "./scanner/filters.js";

const configSchema = z
  .object({
    model: z.custom<TranslateKitConfig["model"]>(
      (val) => val != null && typeof val === "object",
      { message: "model must be an AI SDK LanguageModel instance" },
    ),
    mode: z.enum(["keys", "inline"]).default("keys"),
    sourceLocale: z.string().min(1),
    targetLocales: z.array(z.string().min(1)).min(1),
    messagesDir: z.string().min(1),
    splitByNamespace: z.boolean().default(false).optional(),
    typeSafe: z.boolean().default(false).optional(),
    translation: z
      .object({
        batchSize: z.number().int().positive().default(50),
        context: z.string().optional(),
        glossary: z.record(z.string(), z.string()).optional(),
        tone: z.string().optional(),
        retries: z.number().int().min(0).default(2),
        concurrency: z.number().int().positive().default(3),
        validatePlaceholders: z.boolean().default(true).optional(),
      })
      .optional(),
    scan: z
      .object({
        include: z.array(z.string()),
        exclude: z.array(z.string()).optional(),
        translatableProps: z
          .array(z.string())
          .default([...DEFAULT_TRANSLATABLE_PROPS]),
        i18nImport: z.string().default("next-intl"),
      })
      .optional(),
    inline: z
      .object({
        componentPath: z.string().min(1),
      })
      .optional(),
  })
  .refine((data) => data.mode !== "inline" || data.inline != null, {
    message: "inline options are required when mode is 'inline'",
    path: ["inline"],
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
