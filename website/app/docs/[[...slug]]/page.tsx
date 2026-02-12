import type { TOCItemType } from "fumadocs-core/toc";
import defaultMdxComponents from "fumadocs-ui/mdx";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/page";
import type { MDXContent } from "mdx/types";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";

interface MdxPageData {
	title?: string;
	description?: string;
	body: MDXContent;
	toc: TOCItemType[];
}

export default async function Page(props: {
	params: Promise<{ slug?: string[] }>;
}) {
	const { slug } = await props.params;
	const page = source.getPage(slug);
	if (!page) notFound();

	const data = page.data as unknown as MdxPageData;
	const MDX = data.body;

	return (
		<DocsPage toc={data.toc}>
			<DocsTitle>{data.title}</DocsTitle>
			<DocsDescription>{data.description}</DocsDescription>
			<DocsBody>
				<MDX components={{ ...defaultMdxComponents }} />
			</DocsBody>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: {
	params: Promise<{ slug?: string[] }>;
}) {
	const { slug } = await props.params;
	const page = source.getPage(slug);
	if (!page) notFound();

	return {
		title: page.data.title,
		description: page.data.description,
	};
}
