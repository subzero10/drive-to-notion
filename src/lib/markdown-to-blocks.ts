/**
 * Convert markdown to Notion block format using micromark + mdast.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import type {
	BlockContent,
	List,
	ListItem,
	PhrasingContent,
	Root,
	Table,
} from "mdast";

const NOTION_VERSION = "2022-06-28";

export type NotionBlock =
	| { type: "paragraph"; paragraph: { rich_text: NotionRichText[] } }
	| {
			type: "heading_1";
			heading_1: { rich_text: NotionRichText[] };
	  }
	| {
			type: "heading_2";
			heading_2: { rich_text: NotionRichText[] };
	  }
	| {
			type: "heading_3";
			heading_3: { rich_text: NotionRichText[] };
	  }
	| {
			type: "bulleted_list_item";
			bulleted_list_item: { rich_text: NotionRichText[] };
	  }
	| {
			type: "numbered_list_item";
			numbered_list_item: { rich_text: NotionRichText[] };
	  }
	| {
			type: "quote";
			quote: { rich_text: NotionRichText[] };
	  }
	| {
			type: "code";
			code: {
				rich_text: NotionRichText[];
				language: string;
			};
	  }
	| { type: "divider"; divider: Record<string, never> };

export interface NotionRichText {
	type: "text";
	text: { content: string; link: { url: string } | null };
	annotations?: {
		bold?: boolean;
		italic?: boolean;
		strikethrough?: boolean;
		underline?: boolean;
		code?: boolean;
		color?: string;
	};
}

function phrasingToRichText(nodes: PhrasingContent[]): NotionRichText[] {
	const result: NotionRichText[] = [];

	for (const node of nodes) {
		if (node.type === "text") {
			result.push({
				type: "text",
				text: { content: node.value, link: null },
				annotations: {
					bold: false,
					italic: false,
					strikethrough: false,
					underline: false,
					code: false,
					color: "default",
				},
			});
		} else if (node.type === "strong") {
			const inner = phrasingToRichText(node.children);
			for (const r of inner) {
				result.push({
					...r,
					annotations: {
						...r.annotations,
						bold: true,
					},
				});
			}
		} else if (node.type === "emphasis") {
			const inner = phrasingToRichText(node.children);
			for (const r of inner) {
				result.push({
					...r,
					annotations: {
						...r.annotations,
						italic: true,
					},
				});
			}
		} else if (node.type === "delete") {
			const inner = phrasingToRichText(node.children);
			for (const r of inner) {
				result.push({
					...r,
					annotations: {
						...r.annotations,
						strikethrough: true,
					},
				});
			}
		} else if (node.type === "inlineCode") {
			result.push({
				type: "text",
				text: { content: node.value, link: null },
				annotations: {
					bold: false,
					italic: false,
					strikethrough: false,
					underline: false,
					code: true,
					color: "default",
				},
			});
		} else if (node.type === "link") {
			const inner = phrasingToRichText(node.children);
			for (const r of inner) {
				result.push({
					...r,
					text: { content: r.text.content, link: { url: node.url } },
				});
			}
		} else if (node.type === "break") {
			result.push({
				type: "text",
				text: { content: "\n", link: null },
				annotations: {
					bold: false,
					italic: false,
					strikethrough: false,
					underline: false,
					code: false,
					color: "default",
				},
			});
		}
		// Skip image, imageReference, linkReference, footnoteReference, html
	}

	return result;
}

function getPhrasingText(nodes: PhrasingContent[]): string {
	let out = "";
	for (const node of nodes) {
		if (node.type === "text") {
			out += node.value;
		} else if (
			node.type === "strong" ||
			node.type === "emphasis" ||
			node.type === "delete" ||
			node.type === "link"
		) {
			out += getPhrasingText(node.children);
		} else if (node.type === "inlineCode") {
			out += node.value;
		} else if (node.type === "break") {
			out += "\n";
		}
		// Skip image, imageReference, linkReference, footnoteReference, html
	}
	return out;
}

function getBlockText(node: BlockContent): string {
	if (node.type === "paragraph") {
		return node.children
			.filter((c): c is { type: "text"; value: string } => c.type === "text")
			.map((c) => c.value)
			.join("");
	}
	if (node.type === "heading") {
		return node.children
			.filter((c): c is { type: "text"; value: string } => c.type === "text")
			.map((c) => c.value)
			.join("");
	}
	if (node.type === "blockquote") {
		return node.children
			.map((c) => getBlockText(c as BlockContent))
			.join("\n");
	}
	if (node.type === "code") {
		return node.value;
	}
	return "";
}

function listItemToRichText(item: ListItem): NotionRichText[] {
	const firstChild = item.children[0];
	if (firstChild?.type === "paragraph") {
		return phrasingToRichText(firstChild.children);
	}
	return phrasingToRichText([]);
}

function processBlock(node: BlockContent, listOrdered?: boolean): NotionBlock[] {
	if (node.type === "paragraph") {
		const richText = phrasingToRichText(node.children);
		if (richText.length === 0) {
			richText.push({
				type: "text",
				text: { content: " ", link: null },
				annotations: {
					bold: false,
					italic: false,
					strikethrough: false,
					underline: false,
					code: false,
					color: "default",
				},
			});
		}
		return [{ type: "paragraph", paragraph: { rich_text: richText } }];
	}

	if (node.type === "heading") {
		const richText = phrasingToRichText(node.children);
		if (richText.length === 0) {
			richText.push({
				type: "text",
				text: { content: " ", link: null },
				annotations: {
					bold: false,
					italic: false,
					strikethrough: false,
					underline: false,
					code: false,
					color: "default",
				},
			});
		}
		const block = { rich_text: richText };
		if (node.depth === 1) return [{ type: "heading_1", heading_1: block }];
		if (node.depth === 2) return [{ type: "heading_2", heading_2: block }];
		return [{ type: "heading_3", heading_3: block }];
	}

	if (node.type === "blockquote") {
		const richTextParts: NotionRichText[] = [];
		for (const child of node.children) {
			if (child.type === "paragraph") {
				richTextParts.push(...phrasingToRichText(child.children));
				richTextParts.push({
					type: "text",
					text: { content: "\n", link: null },
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: "default",
					},
				});
			} else {
				const inner = processBlock(child as BlockContent);
				const first = inner[0];
				if (first && "paragraph" in first) {
					richTextParts.push(...first.paragraph.rich_text);
				}
			}
		}
		const richText =
			richTextParts.length > 0
				? richTextParts.slice(0, -1)
				: [
						{
							type: "text" as const,
							text: { content: " ", link: null as { url: string } | null },
							annotations: {
								bold: false,
								italic: false,
								strikethrough: false,
								underline: false,
								code: false,
								color: "default",
							},
						},
					];
		return [{ type: "quote", quote: { rich_text: richText } }];
	}

	if (node.type === "code") {
		const richText: NotionRichText[] = [
			{
				type: "text",
				text: { content: node.value, link: null },
				annotations: {
					bold: false,
					italic: false,
					strikethrough: false,
					underline: false,
					code: false,
					color: "default",
				},
			},
		];
		const lang = node.lang ?? "plain text";
		return [
			{
				type: "code",
				code: { rich_text: richText, language: lang },
			},
		];
	}

	if (node.type === "list") {
		const list = node as List;
		const blocks: NotionBlock[] = [];
		for (const item of list.children) {
			const richText = listItemToRichText(item);
			if (richText.length === 0) {
				richText.push({
					type: "text",
					text: { content: " ", link: null },
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: "default",
					},
				});
			}
			if (list.ordered) {
				blocks.push({
					type: "numbered_list_item",
					numbered_list_item: { rich_text: richText },
				});
			} else {
				blocks.push({
					type: "bulleted_list_item",
					bulleted_list_item: { rich_text: richText },
				});
			}
		}
		return blocks;
	}

	if (node.type === "thematicBreak") {
		return [{ type: "divider", divider: {} }];
	}

	if (node.type === "table") {
		// Notion tables need table + table_row. Simplify: emit as paragraph with table text
		const table = node as Table;
		const rows = table.children
			.map((row) =>
				row.children
					.map((cell) => getPhrasingText(cell.children))
					.join(" | ")
			)
			.join("\n");
		return [
			{
				type: "paragraph",
				paragraph: {
					rich_text: [
						{
							type: "text",
							text: { content: rows || " ", link: null },
							annotations: {
								bold: false,
								italic: false,
								strikethrough: false,
								underline: false,
								code: false,
								color: "default",
							},
						},
					],
				},
			},
		];
	}

	// html, definition, footnoteDefinition - emit as empty paragraph
	return [
		{
			type: "paragraph",
			paragraph: {
				rich_text: [
					{
						type: "text",
						text: { content: " ", link: null },
						annotations: {
							bold: false,
							italic: false,
							strikethrough: false,
							underline: false,
							code: false,
							color: "default",
						},
					},
				],
			},
		},
	];
}

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
	const root = fromMarkdown(markdown) as Root;
	const blocks: NotionBlock[] = [];

	for (const node of root.children) {
		if (node.type === "paragraph" || node.type === "heading") {
			blocks.push(...processBlock(node as BlockContent));
		} else if (
			node.type === "blockquote" ||
			node.type === "code" ||
			node.type === "list" ||
			node.type === "thematicBreak" ||
			node.type === "table"
		) {
			blocks.push(...processBlock(node as BlockContent));
		} else if (
			node.type === "break" ||
			node.type === "emphasis" ||
			node.type === "strong" ||
			node.type === "delete" ||
			node.type === "inlineCode" ||
			node.type === "link" ||
			node.type === "image" ||
			node.type === "imageReference" ||
			node.type === "linkReference" ||
			node.type === "footnoteReference" ||
			node.type === "html" ||
			node.type === "definition" ||
			node.type === "footnoteDefinition"
		) {
			// These at root level are unusual - skip or wrap
			continue;
		}
	}

	return blocks;
}

export { NOTION_VERSION };
