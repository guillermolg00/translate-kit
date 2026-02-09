import { parse, type ParserPlugin } from "@babel/parser";
import type { File } from "@babel/types";

const plugins: ParserPlugin[] = ["typescript", "jsx", "decorators-legacy"];

export function parseFile(code: string, filename: string): File {
  return parse(code, {
    sourceType: "module",
    plugins:
      filename.endsWith(".tsx") || filename.endsWith(".ts")
        ? plugins
        : plugins.filter((p) => p !== "typescript"),
    sourceFilename: filename,
  });
}
