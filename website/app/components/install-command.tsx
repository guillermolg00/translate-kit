"use client";

import { useState } from "react";

const packageManagers = [
	{ name: "npm", command: "npm i -g translate-kit" },
	{ name: "pnpm", command: "pnpm add -g translate-kit" },
	{ name: "bun", command: "bun add -g translate-kit" },
	{ name: "yarn", command: "yarn global add translate-kit" },
];

export function InstallCommand() {
	const [selected, setSelected] = useState(0);
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(packageManagers[selected].command);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="mt-8 w-full max-w-xl">
			<div className="flex items-center gap-2 rounded-t-lg border border-fd-border bg-fd-muted/30 px-4 py-2">
				{packageManagers.map((pm, i) => (
					<button
						key={pm.name}
						onClick={() => setSelected(i)}
						className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
							selected === i
								? "bg-fd-primary text-fd-primary-foreground"
								: "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
						}`}
					>
						{pm.name}
					</button>
				))}
			</div>
			<div className="group relative rounded-b-lg border border-t-0 border-fd-border bg-fd-background">
				<div className="flex items-center justify-between px-4 py-3">
					<code className="font-mono text-sm text-fd-foreground">
						{packageManagers[selected].command}
					</code>
					<button
						onClick={handleCopy}
						className="ml-4 rounded px-2 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
						aria-label="Copy to clipboard"
					>
						{copied ? (
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<polyline points="20 6 9 17 4 12" />
							</svg>
						) : (
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
							</svg>
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
