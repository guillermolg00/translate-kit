# translate-kit — Plan de Proyecto

> npm: `translate-kit` (disponible)

> SDK open source para generar traducciones en build time usando los modelos y API keys del propio usuario, con Vercel AI SDK como capa de abstraccion. Compatible con next-intl, extensible a cualquier framework.

## Vision

Un paquete npm que se integra con `next-intl` y genera traducciones automaticamente en build time. El usuario elige su modelo (OpenAI, Anthropic, Google, Mistral, local via Ollama, etc.) y paga directamente al proveedor. Sin intermediarios, sin vendor lock-in, sin servicios externos.

```bash
npx translate-kit
# Lee messages/en.json -> Traduce con tu modelo -> Escribe messages/es.json, messages/ru.json
```

---

## Arquitectura General

```
translate-kit (npm package)
├── CLI (npx translate-kit)
├── Config loader (translate-kit.config.ts)
├── Code scanner (Babel AST — extrae strings del codigo fuente)
├── Diff engine (detecta keys nuevas/modificadas)
├── Translation engine (Vercel AI SDK)
├── Codegen (reescribe componentes con t() calls)
├── Output writer (JSON compatible con next-intl)
└── Cache layer (evita re-traducir lo que no cambio)
```

### Modos de operacion

El SDK soporta dos modos que el usuario elige segun su preferencia:

```
Modo 1: Dictionary (clasico)
  - El usuario mantiene messages/en.json manualmente
  - El SDK solo traduce a los target locales
  - Simple, predecible, control total

Modo 2: Code Scanning (automatico)
  - El SDK escanea el codigo fuente con Babel parser
  - Extrae strings traducibles del JSX/TSX automaticamente
  - Genera messages/en.json como fuente de verdad
  - Opcionalmente reescribe componentes con t() calls (codegen)
  - Cero mantenimiento manual de diccionarios
```

### Flujo de ejecucion (Modo 1: Dictionary)

```
1. Lee translate-kit.config.ts (locales, modelo, opciones)
2. Lee messages/{defaultLocale}.json (fuente de verdad)
3. Para cada locale target:
   a. Lee messages/{locale}.json existente (si existe)
   b. Compara con fuente: detecta keys nuevas, modificadas, eliminadas
   c. Agrupa keys pendientes en batches
   d. Envia cada batch al modelo via Vercel AI SDK
   e. Valida respuesta (JSON valido, keys correctas, sin keys faltantes)
   f. Merge con traducciones existentes
   g. Escribe messages/{locale}.json
4. Actualiza .translate-lock.json (hashes para cache)
5. Reporte: X keys traducidas, Y cacheadas, Z errores
```

### Flujo de ejecucion (Modo 2: Code Scanning)

```
1. Lee translate-kit.config.ts (locales, modelo, scan config)
2. SCAN: Recorre archivos .tsx/.ts segun include/exclude globs
   a. Parsea cada archivo con Babel parser (TSX + TS plugins)
   b. Traversa el AST buscando strings traducibles:
      - JSXText: texto literal dentro de elementos (<h1>Hello</h1>)
      - JSXAttribute: props traducibles (placeholder, title, alt, aria-label)
      - Template literals con texto user-facing (opcional)
   c. Genera key automatica por cada string (hash o path-based)
   d. Registra ubicacion en el codigo (file:line:col) para codegen
3. DIFF: Compara strings extraidos vs. messages/en.json existente
   a. Detecta strings nuevos, modificados, eliminados
   b. Solo envia a traducir lo que cambio
4. TRANSLATE: Para cada locale target, traduce keys pendientes via AI SDK
5. CODEGEN (opcional): Reescribe componentes reemplazando strings hardcoded con t() calls
6. OUTPUT: Escribe messages/{locale}.json + actualiza lock file
7. Reporte: X strings escaneados, Y traducidos, Z cacheados
```

---

## Stack Tecnico

| Componente | Tecnologia | Justificacion |
|-----------|-----------|---------------|
| AI models | `ai` (Vercel AI SDK) | Abstraccion unificada para todos los proveedores |
| Providers | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc. | El usuario instala solo el que necesite |
| Structured output | `generateObject()` de AI SDK | Garantiza JSON valido con schema Zod |
| Schema validation | `zod` | Validar estructura de traducciones |
| CLI framework | `citty` o `commander` | Ligero, sin dependencias pesadas |
| Config | `cosmiconfig` o carga directa de TS | Soporte .ts, .js, .json |
| Code scanning | `@babel/parser` + `@babel/traverse` | Parser JSX/TSX ligero, estandar de la industria |
| AST types | `@babel/types` | Helpers para crear/manipular nodos AST |
| Codegen | `@babel/generator` | Regenerar codigo desde AST modificado |
| Diff/hash | `crypto` (node built-in) | SHA256 para detectar cambios |
| File I/O | `fs/promises` (node built-in) | Sin dependencias extra |

---

## Fase 1: MVP funcional

**Objetivo:** CLI que traduce `messages/en.json` a N locales usando cualquier modelo de AI SDK.

### 1.1 Estructura del paquete

```
translate-kit/
├── src/
│   ├── cli.ts              # Entry point CLI
│   ├── config.ts            # Carga y validacion de config
│   ├── diff.ts              # Deteccion de cambios (nuevo, modificado, eliminado)
│   ├── translate.ts         # Motor de traduccion (AI SDK)
│   ├── writer.ts            # Escritura de archivos JSON
│   ├── cache.ts             # Lock file con hashes
│   ├── logger.ts            # Output bonito en terminal
│   ├── types.ts             # Tipos compartidos
│   └── scanner/
│       ├── index.ts          # Orquestador del scan
│       ├── parser.ts         # Babel parser config (TSX/TS plugins)
│       ├── extractor.ts      # AST visitor: extrae strings traducibles
│       ├── key-generator.ts  # Genera keys estables (hash o path-based)
│       ├── codegen.ts        # Reescribe componentes con t() calls
│       └── filters.ts        # Reglas de que es traducible y que no
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE                  # MIT
└── tests/
    ├── diff.test.ts
    ├── translate.test.ts
    ├── scanner/
    │   ├── extractor.test.ts
    │   ├── key-generator.test.ts
    │   ├── codegen.test.ts
    │   └── fixtures/
    │       ├── simple-component.tsx
    │       ├── component-with-props.tsx
    │       ├── component-with-interpolation.tsx
    │       └── expected-output/
    └── fixtures/
        ├── en.json
        └── es.json
```

### 1.2 Configuracion del usuario

```ts
// translate-kit.config.ts
import { defineConfig } from "translate-kit";

export default defineConfig({
  // Locales
  sourceLocale: "en",
  targetLocales: ["es", "ru", "pt"],

  // Archivos
  messagesDir: "./messages",        // donde estan los JSON
  lockFile: ".translate-lock.json", // cache de hashes

  // Modelo (usa Vercel AI SDK)
  model: {
    provider: "openai",             // cualquier provider de AI SDK
    model: "gpt-4o-mini",           // modelo especifico
    // apiKey se lee de env: OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
  },

  // Opciones de traduccion
  translation: {
    batchSize: 50,                  // keys por request (para no exceder context)
    context: "SaaS application for numerology and meditation",
    glossary: {                     // terminos que NO se traducen
      "Numa365": "Numa365",
      "numerology": null,           // null = traducir normalmente
    },
    tone: "professional",           // informal, professional, casual
    preserveFormatting: true,       // mantener markdown, HTML, placeholders
  },

  // Code scanning (Modo 2)
  scan: {
    enabled: true,                  // activar code scanning
    include: ["src/**/*.tsx", "app/**/*.tsx", "components/**/*.tsx"],
    exclude: ["**/*.test.*", "**/*.stories.*", "**/node_modules/**"],
    keyStrategy: "path",            // "path" (ComponentName.text) o "hash" (sha de contenido)
    translatableProps: [            // props JSX que contienen texto traducible
      "placeholder", "title", "alt", "aria-label",
      "aria-description", "aria-placeholder",
    ],
    ignorePatterns: [               // regex de strings a ignorar
      "^\\s*$",                     // whitespace
      "^[\\d\\W]+$",               // solo numeros/simbolos
      "^https?://",                 // URLs
      "^[a-z]+(-[a-z]+)*$",        // kebab-case (css classes, ids)
    ],
    codegen: {
      enabled: false,               // reescribir componentes automaticamente
      importFrom: "next-intl",      // libreria de import
      hookName: "useTranslations",  // nombre del hook a insertar
      dryRun: true,                 // mostrar cambios sin escribir (por defecto)
    },
  },

  // Opciones avanzadas
  retries: 2,
  concurrency: 3,                  // locales en paralelo
  dryRun: false,                   // solo mostrar que se traduciria
});
```

### 1.3 Motor de traduccion con AI SDK

```ts
// src/translate.ts (concepto central)
import { generateObject } from "ai";
import { z } from "zod";

interface TranslationBatch {
  keys: Record<string, string>;  // { "help.title": "Help Center", ... }
  locale: string;
  context?: string;
  glossary?: Record<string, string | null>;
}

export async function translateBatch(
  model: LanguageModel,   // de AI SDK - cualquier provider
  batch: TranslationBatch,
): Promise<Record<string, string>> {
  // Construir schema Zod dinamico basado en las keys
  const schemaShape: Record<string, z.ZodString> = {};
  for (const key of Object.keys(batch.keys)) {
    schemaShape[key] = z.string();
  }
  const schema = z.object(schemaShape);

  const { object } = await generateObject({
    model,
    schema,
    prompt: buildTranslationPrompt(batch),
  });

  return object;
}

function buildTranslationPrompt(batch: TranslationBatch): string {
  const lines = [
    `Translate the following UI strings from English to ${batch.locale}.`,
    `Return a JSON object with the exact same keys and translated values.`,
    "",
    "Rules:",
    "- Preserve all placeholders like {name}, {count}, {{variable}}",
    "- Preserve HTML tags if present (<strong>, <br/>, etc.)",
    "- Preserve markdown formatting",
    "- Do NOT translate brand names or technical terms in the glossary",
    "- Match the tone: natural, fluent, not robotic",
    "- Use locale-appropriate punctuation and formatting",
  ];

  if (batch.context) {
    lines.push("", `Context: This is for a ${batch.context}`);
  }

  if (batch.glossary && Object.keys(batch.glossary).length > 0) {
    lines.push("", "Glossary (do not translate these):");
    for (const [term, translation] of Object.entries(batch.glossary)) {
      if (translation) {
        lines.push(`  - "${term}" -> "${translation}"`);
      }
    }
  }

  lines.push("", "Strings to translate:", JSON.stringify(batch.keys, null, 2));

  return lines.join("\n");
}
```

### 1.4 Diff engine (deteccion de cambios)

```ts
// src/diff.ts (concepto)
import crypto from "crypto";

interface DiffResult {
  added: Record<string, string>;    // keys nuevas (no existen en target)
  modified: Record<string, string>; // keys cuyo valor source cambio
  removed: string[];                // keys que ya no existen en source
  unchanged: string[];              // keys sin cambios
}

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// Lock file estructura:
// { "help.title": { hash: "a1b2c3", locales: ["es", "ru"] } }

export function diff(
  source: Record<string, string>,       // flat keys del source locale
  existing: Record<string, string>,      // flat keys del target locale
  lockHashes: Record<string, string>,    // hashes del ultimo run
): DiffResult {
  const added: Record<string, string> = {};
  const modified: Record<string, string> = {};
  const removed: string[] = [];
  const unchanged: string[] = [];

  // Detectar added y modified
  for (const [key, value] of Object.entries(source)) {
    const currentHash = hashValue(value);
    if (!(key in existing)) {
      added[key] = value;
    } else if (lockHashes[key] !== currentHash) {
      modified[key] = value;
    } else {
      unchanged.push(key);
    }
  }

  // Detectar removed
  for (const key of Object.keys(existing)) {
    if (!(key in source)) {
      removed.push(key);
    }
  }

  return { added, modified, removed, unchanged };
}
```

### 1.5 Code Scanner (Babel AST)

El scanner es el corazon del Modo 2. Usa Babel parser para generar un AST ESTree-compatible
de cada archivo TSX/TS, y luego traversa el arbol buscando strings traducibles.

**Dependencias:**
- `@babel/parser` — parsea TSX/TS a AST (~200KB, sin dependencias pesadas)
- `@babel/traverse` — recorre el AST con visitors
- `@babel/generator` — regenera codigo desde AST modificado (para codegen)
- `@babel/types` — helpers de tipos de nodos

#### Parser

```ts
// src/scanner/parser.ts
import { parse } from "@babel/parser";

export function parseFile(code: string, filename: string) {
  return parse(code, {
    sourceType: "module",
    plugins: [
      "typescript",
      "jsx",
      "decorators-legacy",          // por si usan decoradores
      "classProperties",
      "optionalChaining",
      "nullishCoalescingOperator",
    ],
    sourceFilename: filename,        // para reportes de error
  });
}
```

#### Extractor (AST Visitor)

```ts
// src/scanner/extractor.ts
import traverse from "@babel/traverse";
import type { Node } from "@babel/types";

interface ExtractedString {
  text: string;                     // el string extraido
  type: "jsx-text" | "jsx-prop" | "template-literal";
  file: string;                     // ruta del archivo
  line: number;                     // linea en el codigo
  column: number;                   // columna
  componentName: string | null;     // nombre del componente padre
  propName: string | null;          // nombre del prop (si aplica)
  context: {                        // metadata para mejor traduccion
    parentTag: string | null;       // h1, p, button, span, etc.
    siblingText: string[];          // texto cercano para contexto
  };
}

export function extractStrings(
  ast: Node,
  filename: string,
  options: ScanOptions,
): ExtractedString[] {
  const results: ExtractedString[] = [];

  traverse(ast, {
    // ─── JSX Text: <h1>Help Center</h1> ───
    JSXText(path) {
      const text = path.node.value.trim();
      if (!text || shouldIgnore(text, options.ignorePatterns)) return;

      results.push({
        text,
        type: "jsx-text",
        file: filename,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        propName: null,
        context: {
          parentTag: getParentTagName(path),
          siblingText: getSiblingTexts(path),
        },
      });
    },

    // ─── JSX Props: placeholder="Your name" ───
    JSXAttribute(path) {
      const propName = path.node.name.type === "JSXIdentifier"
        ? path.node.name.name
        : null;

      if (!propName || !options.translatableProps.includes(propName)) return;

      const value = path.node.value;
      if (!value || value.type !== "StringLiteral") return;

      const text = value.value.trim();
      if (!text || shouldIgnore(text, options.ignorePatterns)) return;

      results.push({
        text,
        type: "jsx-prop",
        file: filename,
        line: value.loc?.start.line ?? 0,
        column: value.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        propName,
        context: {
          parentTag: getParentTagName(path),
          siblingText: [],
        },
      });
    },

    // ─── JSX Expressions con string literal: {"Hello"} ───
    JSXExpressionContainer(path) {
      const expr = path.node.expression;
      if (expr.type !== "StringLiteral") return;

      const text = expr.value.trim();
      if (!text || shouldIgnore(text, options.ignorePatterns)) return;

      results.push({
        text,
        type: "jsx-text",
        file: filename,
        line: expr.loc?.start.line ?? 0,
        column: expr.loc?.start.column ?? 0,
        componentName: getComponentName(path),
        propName: null,
        context: {
          parentTag: getParentTagName(path),
          siblingText: [],
        },
      });
    },
  });

  return results;
}

// ─── Helpers ───

function shouldIgnore(text: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p).test(text));
}

function getComponentName(path: NodePath): string | null {
  // Sube por el AST hasta encontrar el FunctionDeclaration o ArrowFunction
  // que define el componente React
  let current = path.parentPath;
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id) {
      return current.node.id.name;
    }
    if (current.isVariableDeclarator() && current.node.id.type === "Identifier") {
      return current.node.id.name;
    }
    current = current.parentPath;
  }
  return null;
}

function getParentTagName(path: NodePath): string | null {
  // Encuentra el JSXElement padre mas cercano
  let current = path.parentPath;
  while (current) {
    if (current.isJSXElement()) {
      const opening = current.node.openingElement;
      if (opening.name.type === "JSXIdentifier") {
        return opening.name.name;
      }
    }
    current = current.parentPath;
  }
  return null;
}

function getSiblingTexts(path: NodePath): string[] {
  // Recolecta texto de siblings para dar contexto al modelo
  const parent = path.parentPath;
  if (!parent?.isJSXElement()) return [];

  return parent.node.children
    .filter((c): c is JSXText => c.type === "JSXText")
    .map((c) => c.value.trim())
    .filter(Boolean)
    .slice(0, 3);
}
```

#### Key Generator

Genera keys estables para cada string extraido. Soporta dos estrategias:

```ts
// src/scanner/key-generator.ts
import crypto from "crypto";

type KeyStrategy = "path" | "hash";

export function generateKey(
  extracted: ExtractedString,
  strategy: KeyStrategy,
): string {
  switch (strategy) {
    case "path":
      return generatePathKey(extracted);
    case "hash":
      return generateHashKey(extracted);
  }
}

// Estrategia "path": ComponentName.parentTag_index
// Ejemplo: Hero.heading, ContactForm.placeholder_name, Footer.link_about
function generatePathKey(extracted: ExtractedString): string {
  const component = extracted.componentName || "unknown";
  const slug = slugify(extracted.text, 30); // primeros 30 chars como slug

  if (extracted.propName) {
    return `${component}.${extracted.propName}_${slug}`;
  }

  const tag = extracted.context.parentTag || "text";
  return `${component}.${tag}_${slug}`;
}

// Estrategia "hash": hash corto del contenido (como gt-next)
// Estable: el mismo texto siempre genera la misma key
function generateHashKey(extracted: ExtractedString): string {
  const hash = crypto
    .createHash("sha256")
    .update(extracted.text)
    .digest("hex")
    .slice(0, 12);
  return hash;
}

function slugify(text: string, maxLength: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, maxLength);
}
```

#### Codegen (reescritura automatica de componentes)

Opcionalmente, el scanner puede reescribir los componentes para reemplazar
strings hardcoded con llamadas a `t()` de next-intl:

```ts
// src/scanner/codegen.ts
//
// ANTES (input):
//   export function Hero() {
//     return (
//       <section>
//         <h1>Explore the Power of Numbers</h1>
//         <p>Discover courses and community</p>
//         <input placeholder="Search..." />
//       </section>
//     );
//   }
//
// DESPUES (output):
//   import { useTranslations } from "next-intl";
//
//   export function Hero() {
//     const t = useTranslations("Hero");
//     return (
//       <section>
//         <h1>{t("heading_explore_the_power_of_numb")}</h1>
//         <p>{t("p_discover_courses_and_communi")}</p>
//         <input placeholder={t("placeholder_search")} />
//       </section>
//     );
//   }
//
// El codegen:
// 1. Inserta el import de next-intl si no existe
// 2. Inserta la llamada useTranslations() al inicio del componente
// 3. Reemplaza cada JSXText y prop traducible con {t("key")}
// 4. Preserva formato, comments, y todo lo demas via @babel/generator
```

#### Filtros inteligentes

El scanner necesita distinguir texto user-facing de codigo/markup:

```ts
// src/scanner/filters.ts

// Props que SIEMPRE contienen texto traducible
const TRANSLATABLE_PROPS = [
  "placeholder", "title", "alt",
  "aria-label", "aria-description", "aria-placeholder",
  "label", "description", "helperText", "errorMessage",
];

// Props que NUNCA contienen texto traducible
const NON_TRANSLATABLE_PROPS = [
  "className", "id", "name", "type", "href", "src", "key",
  "style", "ref", "data-testid", "data-cy", "role",
  "htmlFor", "target", "rel", "method", "action",
  "onChange", "onClick", "onSubmit",   // event handlers
];

// Tags cuyos hijos son probablemente traducibles
const TRANSLATABLE_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",  // headings
  "p", "span", "label", "legend",        // text
  "button", "a",                          // interactive
  "li", "dt", "dd", "th", "td",          // list/table
  "figcaption", "caption", "summary",     // descriptive
  "title",                                // SVG title
];

// Tags cuyos hijos NO son traducibles
const NON_TRANSLATABLE_TAGS = [
  "script", "style", "code", "pre", "kbd", "samp", "var",
];

// Patrones de texto que no son traducibles
const IGNORE_PATTERNS = [
  /^\s*$/,                    // solo whitespace
  /^[\d\W]+$/,               // solo numeros/simbolos (precios, etc.)
  /^https?:\/\//,            // URLs
  /^[a-z]+(-[a-z]+)*$/,      // kebab-case (css classes)
  /^[A-Z_]+$/,               // CONSTANTES
  /^\{.*\}$/,                // expresiones JSX: {variable}
  /^[./#@!]/,                // paths, selectores, decoradores
  /^[\w.]+@[\w.]+$/,         // emails
];
```

#### Output del scanner

El scan genera un reporte detallado y el JSON de mensajes:

```
npx translate-kit scan

Scanning 47 files...

components/marketing/hero.tsx
  L12  <h1>  "Explore the Power of Numbers"    -> Hero.heading_explore_the_power
  L13  <p>   "Discover courses and community"   -> Hero.p_discover_courses_and
  L15  placeholder "Search..."                  -> Hero.placeholder_search

components/pricing/pricing-faq.tsx
  L8   <h2>  "Frequently Asked Questions"       -> PricingFaq.heading_frequently_asked
  L12  <p>   "What is the cost of the..."       -> PricingFaq.p_what_is_the_cost

... (45 more files)

Summary:
  Files scanned:  47
  Strings found:  284
  New strings:    12
  Modified:       3
  Unchanged:      269

Generated: messages/en.json (284 keys)
```

### 1.6 CLI

```ts
// src/cli.ts
// npx translate-kit <command> [options]
//
// Comandos:
//   translate     Traducir keys pendientes (default)
//   scan          Escanear codigo fuente y extraer strings
//   codegen       Reescribir componentes con t() calls
//   init          Generar config de ejemplo
//   stats         Mostrar estado de traducciones
//
// Flags globales:
//   --dry-run     Mostrar que se haria sin ejecutar
//   --force       Ignorar cache, re-procesar todo
//   --locale es   Operar solo en un locale especifico
//   --verbose     Output detallado
//
// Atajos:
//   npx translate-kit              # Solo traducir (modo dictionary)
//   npx translate-kit --scan       # Scan + translate en un paso
//   npx translate-kit scan         # Solo escanear, generar en.json
//   npx translate-kit codegen      # Solo reescribir componentes
//   npx translate-kit codegen --dry-run  # Preview de cambios al codigo
```

Output esperado en terminal:

```
translate-kit v1.0.0
Model: gpt-4o-mini (OpenAI)
Source: en (142 keys)

Translating to es...
  ✓ 12 new keys translated
  ✓ 3 modified keys re-translated
  - 127 keys unchanged (cached)
  ✗ 0 keys removed

Translating to ru...
  ✓ 12 new keys translated
  ✓ 3 modified keys re-translated
  - 127 keys unchanged (cached)
  ✗ 0 keys removed

Done in 4.2s | 30 translations | ~$0.003 estimated cost
```

### 1.6 Integracion en build

El usuario lo agrega a su `package.json`:

```json
{
  "scripts": {
    "translate": "translate-kit",
    "translate:dry": "translate-kit --dry-run",
    "translate:force": "translate-kit --force",
    "scan": "translate-kit scan",
    "scan:codegen": "translate-kit scan && translate-kit codegen --dry-run",
    "build": "translate-kit --scan && next build",
    "build:dict": "translate-kit && next build"
  }
}
```

**Flujo CI/CD tipico:**

```
Modo dictionary:   pnpm build:dict   -> translate -> next build
Modo scan:         pnpm build        -> scan -> translate -> next build
```

---

## Fase 2: Features avanzados

### 2.1 Namespaces / archivos multiples

Soportar estructura de next-intl con multiples archivos:

```
messages/
├── en/
│   ├── common.json
│   ├── marketing.json
│   └── dashboard.json
├── es/
│   ├── common.json
│   ├── marketing.json
│   └── dashboard.json
```

### 2.2 Validacion de calidad

Post-traduccion, validar automaticamente:

- Placeholders preservados (`{name}` existe en source y target)
- HTML tags balanceados
- Longitud razonable (flag si traduccion es 3x mas larga que source)
- Caracteres especiales del locale (acentos, cirilico, etc.)

### 2.3 Pluralizacion con ICU

Soporte para formato ICU que next-intl usa:

```json
{
  "items": "You have {count, plural, =0 {no items} one {# item} other {# items}}"
}
```

El prompt al modelo debe preservar la estructura ICU y solo traducir las partes de texto.

### 2.4 Review mode interactivo

```bash
npx translate-kit --review
```

Muestra cada traduccion nueva y pide confirmacion:

```
[es] help.title
  EN: "Help Center"
  ES: "Centro de ayuda"
  (a)ccept / (e)dit / (s)kip / (r)egenerate?
```

### 2.5 Context-aware translation

Opcion de pasar el componente o pagina donde se usa cada key para dar contexto al modelo:

```ts
// En el config
translation: {
  contextFiles: true, // analiza imports para saber donde se usa cada key
}
```

### 2.6 Soporte para modelos locales (Ollama)

Gracias a AI SDK, soportar modelos locales sin costo:

```ts
// translate-kit.config.ts
import { defineConfig } from "translate-kit";

export default defineConfig({
  model: {
    provider: "ollama",        // via @ai-sdk/ollama o custom provider
    model: "llama3.1:8b",
    baseURL: "http://localhost:11434",
  },
});
```

---

## Fase 3: Ecosistema

### 3.1 Plugin para CI/CD

GitHub Action que corre traducciones en PR y comenta con diff:

```yaml
# .github/workflows/translate.yml
- uses: translate-kit/action@v1
  with:
    api-key: ${{ secrets.OPENAI_API_KEY }}
    model: gpt-4o-mini
```

### 3.2 VS Code extension

- Mostrar traducciones inline al lado de las keys
- Autocompletado de keys de traduccion
- Preview de traducciones al hover

### 3.3 Dashboard web (opcional, self-hosted)

UI simple para revisar y editar traducciones manualmente:

```bash
npx translate-kit studio
# Abre localhost:4500 con editor visual de traducciones
```

### 3.4 Soporte para otros frameworks

- `astro-ai-translate` — para Astro
- `remix-ai-translate` — para Remix
- Core compartido, adaptadores por framework

---

## Diferenciacion vs. competencia

| Feature | gt-next | translate-kit | next-intl (solo) |
|---------|---------|-------------------|-----------------|
| Runtime i18n | Propio | next-intl (MIT) | next-intl |
| Traduccion automatica | Su API ($5/10k chars) | Tu modelo (~$0.015/10k chars) | Manual |
| Code scanning (AST) | Si (propio) | Si (Babel parser) | No |
| Auto-codegen | No | Si (reescribe componentes) | No |
| Self-hosted | No | Si | N/A |
| Modelo a eleccion | No | Si (cualquier AI SDK provider) | N/A |
| Modelos locales | No | Si (Ollama, etc.) | N/A |
| Vendor lock-in | Si | No | No |
| Cache incremental | Si | Si | N/A |
| Open source | FSL (source-available) | MIT | MIT |
| Structured output | No (text) | Si (Zod + generateObject) | N/A |
| Modo dual (dict + scan) | No (solo scan) | Si | Solo dict |

---

## Modelo de negocio (si se quiere monetizar)

El paquete es MIT y gratuito para siempre. Opciones de monetizacion opcionales:

1. **Sponsorship** (GitHub Sponsors, Open Collective)
2. **Pro features** (dashboard cloud, translation memory compartida entre proyectos)
3. **Consulting** — setup para empresas
4. **Nada** — mantenerlo como proyecto comunitario puro

---

## Nombre elegido

**`translate-kit`** — disponible en npm. Claro, generico, extensible, no atado a ningun framework.

---

## Milestones

### M1: Proof of Concept (1-2 dias)
- [ ] Script standalone que traduce un JSON con AI SDK
- [ ] Validar structured output con Zod funciona bien para traducciones
- [ ] Probar con OpenAI, Anthropic, y Ollama
- [ ] Medir costos reales por 100, 500, 1000 keys

### M2: MVP — Dictionary mode (3-5 dias)
- [ ] CLI funcional con config file
- [ ] Diff engine con cache (lock file)
- [ ] Batching inteligente (respetar context window)
- [ ] Output compatible con next-intl
- [ ] Manejo de errores y retries
- [ ] Publicar en npm v0.1.0

### M3: Code Scanner (1 semana)
- [ ] Babel parser setup (TSX/TS)
- [ ] AST visitor: extraer JSXText
- [ ] AST visitor: extraer props traducibles (placeholder, alt, title, aria-*)
- [ ] Key generator (path-based + hash-based)
- [ ] Filtros inteligentes (ignorar classNames, URLs, codigo)
- [ ] Generacion automatica de messages/en.json desde scan
- [ ] Tests con fixtures de componentes reales
- [ ] Comando `scan` en CLI

### M4: Codegen (3-5 dias)
- [ ] Reescritura de JSXText -> {t("key")}
- [ ] Reescritura de props -> {t("key")}
- [ ] Insercion de import useTranslations
- [ ] Insercion de const t = useTranslations("Namespace")
- [ ] Preservar formato original (@babel/generator con retainLines)
- [ ] Dry-run mode (mostrar diff sin escribir)
- [ ] Tests con before/after fixtures
- [ ] Comando `codegen` en CLI

### M5: Production ready (1 semana)
- [ ] Tests unitarios y de integracion (scanner + translate + codegen)
- [ ] Namespaces / archivos multiples
- [ ] Validacion de placeholders y formato post-traduccion
- [ ] Soporte ICU / plurales
- [ ] Documentacion con ejemplos para ambos modos
- [ ] GitHub Actions workflow de CI
- [ ] README con badges, GIFs, demo
- [ ] Publicar v1.0.0

### M6: Ecosistema (futuro)
- [ ] Review mode interactivo
- [ ] GitHub Action oficial
- [ ] Translation studio (UI local)
- [ ] Soporte Astro/Remix
- [ ] VS Code extension
- [ ] Context-aware translation (pasar componente como contexto al modelo)
- [ ] Deteccion de interpolacion JSX ({name}, {count}) y conversion a ICU

---

## Riesgos y mitigaciones

| Riesgo | Mitigacion |
|--------|-----------|
| Calidad de traduccion variable entre modelos | Validacion post-traduccion + review mode + tests con fixtures |
| Context window excedido con muchas keys | Batching automatico basado en token count del modelo |
| Structured output falla con modelos pequenos | Fallback a text mode con parsing JSON manual |
| Traducciones inconsistentes entre batches | Incluir glossary + contexto + traducciones previas como referencia |
| Costos inesperados para el usuario | Mostrar estimacion de costo antes de ejecutar + dry-run por defecto la primera vez |
| next-intl cambia su formato | Adaptador desacoplado, facil de actualizar |
| Scanner extrae strings no traducibles | Filtros robustos + ignorePatterns configurables + whitelist de tags/props |
| Scanner rompe formato del codigo al reescribir | @babel/generator con retainLines + codegen dry-run por defecto |
| Keys inestables al refactorizar componentes | Estrategia hash (basada en contenido) es estable; path-based necesita lock file de mapping |
| Falsos positivos en JSX complejo (ternarios, maps) | Heuristicas conservadoras: solo extraer lo que es claramente user-facing |
| Babel no parsea sintaxis experimental | Plugins de Babel configurables, decorators y class properties habilitados por defecto |
