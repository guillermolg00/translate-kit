import { type ParserPlugin, parse } from "@babel/parser";
import type { File } from "@babel/types";

const plugins: ParserPlugin[] = ["typescript", "jsx", "decorators-legacy"];

export function parseFile(code: string, filename: string): File {
	const isTypeScript = /\.(?:ts|tsx|mts|cts)$/.test(filename);
	return parse(code, {
		sourceType: "module",
		plugins: isTypeScript ? plugins : plugins.filter((p) => p !== "typescript"),
		sourceFilename: filename,
	});
}
