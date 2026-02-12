import { join } from "node:path";
import { writeFile, mkdir, readdir } from "node:fs/promises";

export async function generateNextIntlTypes(
  messagesDir: string,
  sourceLocale: string,
  splitByNamespace?: boolean,
): Promise<void> {
  await mkdir(messagesDir, { recursive: true });

  let content: string;

  if (splitByNamespace) {
    const sourceDir = join(messagesDir, sourceLocale);
    let files: string[];
    try {
      files = (await readdir(sourceDir))
        .filter((f) => f.endsWith(".json"))
        .sort();
    } catch {
      files = [];
    }

    if (files.length === 0) {
      content = `type Messages = Record<string, never>;

declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
`;
    } else {
      const imports = files.map((f) => {
        const ns = f.replace(".json", "");
        return `import ${ns} from "./${sourceLocale}/${f}";`;
      });
      const typeEntries = files.map((f) => {
        const ns = f.replace(".json", "");
        return `  ${ns}: typeof ${ns};`;
      });
      content = `${imports.join("\n")}

type Messages = {
${typeEntries.join("\n")}
};

declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
`;
    }
  } else {
    content = `import messages from "./${sourceLocale}.json";

declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
`;
  }

  const outPath = join(messagesDir, "next-intl.d.ts");
  await writeFile(outPath, content, "utf-8");
}
