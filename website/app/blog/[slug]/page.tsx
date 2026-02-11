import { blog } from "@/lib/source";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { InlineTOC } from "fumadocs-ui/components/inline-toc";
import Link from "next/link";
import type { MDXContent } from "mdx/types";
import type { TOCItemType } from "fumadocs-core/toc";

interface BlogPageData {
  title?: string;
  description?: string;
  date: string;
  author: string;
  body: MDXContent;
  toc: TOCItemType[];
}

export default async function BlogPost(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const page = blog.getPage([slug]);
  if (!page) notFound();

  const data = page.data as unknown as BlogPageData;
  const MDX = data.body;

  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <Link
        href="/blog"
        className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        &larr; Back to blog
      </Link>

      <header className="mt-8">
        <time className="text-sm text-fd-muted-foreground">
          {new Date(data.date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">
          {data.title}
        </h1>
        {data.author && (
          <p className="mt-2 text-sm text-fd-muted-foreground">
            By {data.author}
          </p>
        )}
      </header>

      <InlineTOC items={data.toc} className="mt-8" />

      <article className="prose mt-10 dark:prose-invert max-w-none">
        <MDX components={{ ...defaultMdxComponents }} />
      </article>

      <div className="mt-16 border-t border-fd-border pt-8">
        <Link
          href="/blog"
          className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        >
          &larr; Back to blog
        </Link>
      </div>
    </main>
  );
}

export function generateStaticParams() {
  return blog.getPages().map((page) => ({
    slug: page.slugs[0],
  }));
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const page = blog.getPage([slug]);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
