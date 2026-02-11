import { docs, blogPosts } from "@/.source/server";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { loader } from "fumadocs-core/source";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export const blog = loader({
  baseUrl: "/blog",
  source: toFumadocsSource(blogPosts, []),
});
