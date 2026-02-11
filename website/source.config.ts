import {
  defineDocs,
  defineConfig,
  defineCollections,
  frontmatterSchema,
} from "fumadocs-mdx/config";
import { z } from "zod";

export const docs = defineDocs({
  dir: "content/docs",
});

export const blogPosts = defineCollections({
  type: "doc",
  dir: "content/blog",
  schema: frontmatterSchema.extend({
    date: z.string().date().or(z.date()),
    author: z.string().default("Guillermo"),
  }),
});

export default defineConfig({
  mdxOptions: {},
});
