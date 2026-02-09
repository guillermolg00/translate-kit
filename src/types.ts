import type { LanguageModel } from "ai";

export interface TranslationOptions {
  batchSize?: number;
  context?: string;
  glossary?: Record<string, string>;
  tone?: string;
  retries?: number;
  concurrency?: number;
}

export interface ScanOptions {
  include: string[];
  exclude?: string[];
  keyStrategy?: "hash" | "path";
  translatableProps?: string[];
  i18nImport?: string;
}

export interface TranslateKitConfig {
  model: LanguageModel;
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  translation?: TranslationOptions;
  scan?: ScanOptions;
}

export interface DiffResult {
  added: Record<string, string>;
  modified: Record<string, string>;
  removed: string[];
  unchanged: Record<string, string>;
}

export interface LockFile {
  [key: string]: string;
}

export interface ExtractedString {
  text: string;
  type: "jsx-text" | "jsx-attribute" | "jsx-expression" | "t-call";
  file: string;
  line: number;
  column: number;
  componentName?: string;
  propName?: string;
  parentTag?: string;
}

export interface TranslationResult {
  locale: string;
  translated: number;
  cached: number;
  removed: number;
  errors: number;
  duration: number;
}
