import type { Metadata } from "next";
import Link from "next/link";
import { blog } from "@/lib/source";

export const metadata: Metadata = {
	title: "Blog",
	description: "Updates and insights from the translate-kit team.",
};

export default function BlogIndex() {
	const posts = blog
		.getPages()
		.sort(
			(a, b) =>
				new Date(b.data.date as string).getTime() -
				new Date(a.data.date as string).getTime(),
		);

	return (
		<main className="mx-auto max-w-3xl px-6 py-24">
			<h1 className="text-4xl font-bold tracking-tight">Blog</h1>
			<p className="mt-3 text-fd-muted-foreground">
				Updates and insights from the translate-kit team.
			</p>
			<div className="mt-12 flex flex-col gap-8">
				{posts.map((post) => (
					<Link
						key={post.url}
						href={post.url}
						className="group rounded-xl border border-fd-border p-6 transition-colors hover:bg-fd-accent/50"
					>
						<time className="text-sm text-fd-muted-foreground">
							{new Date(post.data.date as string).toLocaleDateString("en-US", {
								year: "numeric",
								month: "long",
								day: "numeric",
							})}
						</time>
						<h2 className="mt-2 text-xl font-semibold group-hover:underline">
							{post.data.title}
						</h2>
						{post.data.description && (
							<p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
								{post.data.description}
							</p>
						)}
					</Link>
				))}
			</div>
		</main>
	);
}
