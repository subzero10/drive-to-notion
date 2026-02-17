/**
 * Notion API client for querying, creating, and updating database pages.
 */

import type { NotionBlock } from "./markdown-to-blocks";
import { markdownToNotionBlocks } from "./markdown-to-blocks";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionEnv {
	NOTION_API_KEY: string;
	NOTION_DATABASE_ID: string;
}

export interface NotionPage {
	id: string;
	properties: {
		[key: string]: {
			type: string;
			title?: { plain_text: string }[];
			rich_text?: { plain_text: string }[];
			date?: { start: string } | null;
		};
	};
}

export interface NotionBlockChild {
	id: string;
	type: string;
}

function notionFetch(
	apiKey: string,
	path: string,
	options: RequestInit = {}
): Promise<Response> {
	return fetch(`${NOTION_API_BASE}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Notion-Version": NOTION_VERSION,
			"Content-Type": "application/json",
			...options.headers,
		},
	});
}

export async function queryDatabaseByDriveId(
	apiKey: string,
	databaseId: string,
	driveFileId: string
): Promise<NotionPage | null> {
	const response = await notionFetch(apiKey, `/databases/${databaseId}/query`, {
		method: "POST",
		body: JSON.stringify({
			filter: {
				property: "Drive File ID",
				rich_text: {
					equals: driveFileId,
				},
			},
			page_size: 1,
		}),
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Notion query failed: ${response.status} ${err}`);
	}

	const data = (await response.json()) as { results: NotionPage[] };
	return data.results[0] ?? null;
}

function formatDateForNotion(isoDate: string): string {
	// Notion date format: ISO 8601, e.g. "2024-01-15T12:00:00.000Z"
	// We can pass through as-is; Notion accepts full ISO
	return isoDate;
}

export async function createPage(
	apiKey: string,
	databaseId: string,
	params: {
		title: string;
		driveFileId: string;
		driveModified: string;
		markdown: string;
	}
): Promise<string> {
	const blocks = markdownToNotionBlocks(params.markdown);

	const createResponse = await notionFetch(apiKey, "/pages", {
		method: "POST",
		body: JSON.stringify({
			parent: { database_id: databaseId },
			properties: {
				Name: {
					title: [{ text: { content: params.title } }],
				},
				"Drive File ID": {
					rich_text: [{ text: { content: params.driveFileId } }],
				},
				"Drive Modified": {
					date: { start: formatDateForNotion(params.driveModified) },
				},
			},
		}),
	});

	if (!createResponse.ok) {
		const err = await createResponse.text();
		throw new Error(`Notion create page failed: ${createResponse.status} ${err}`);
	}

	const pageData = (await createResponse.json()) as { id: string };
	const pageId = pageData.id;

	if (blocks.length > 0) {
		await appendBlocksInBatches(apiKey, pageId, blocks);
	}

	return pageId;
}

const BLOCKS_PER_REQUEST = 100;

async function appendBlocksInBatches(
	apiKey: string,
	blockId: string,
	blocks: NotionBlock[]
): Promise<void> {
	for (let i = 0; i < blocks.length; i += BLOCKS_PER_REQUEST) {
		const batch = blocks.slice(i, i + BLOCKS_PER_REQUEST);
		const response = await notionFetch(
			apiKey,
			`/blocks/${blockId}/children`,
			{
				method: "PATCH",
				body: JSON.stringify({ children: batch }),
			}
		);

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`Notion append blocks failed: ${response.status} ${err}`);
		}
	}
}

async function getBlockChildren(
	apiKey: string,
	blockId: string
): Promise<NotionBlockChild[]> {
	const all: NotionBlockChild[] = [];
	let cursor: string | null = null;

	do {
		const url = new URL(`${NOTION_API_BASE}/blocks/${blockId}/children`);
		url.searchParams.set("page_size", "100");
		if (cursor) url.searchParams.set("start_cursor", cursor);

		const response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Notion-Version": NOTION_VERSION,
			},
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`Notion get block children failed: ${response.status} ${err}`);
		}

		const data = (await response.json()) as {
			results: NotionBlockChild[];
			next_cursor: string | null;
			has_more: boolean;
		};

		all.push(...data.results);
		cursor = data.has_more ? data.next_cursor : null;
	} while (cursor);

	return all;
}

async function deleteBlock(apiKey: string, blockId: string): Promise<void> {
	const response = await notionFetch(apiKey, `/blocks/${blockId}`, {
		method: "DELETE",
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Notion delete block failed: ${response.status} ${err}`);
	}
}

export async function updatePage(
	apiKey: string,
	pageId: string,
	params: { markdown: string; driveModified: string }
): Promise<void> {
	const blocks = markdownToNotionBlocks(params.markdown);

	const existingBlocks = await getBlockChildren(apiKey, pageId);
	for (const block of existingBlocks) {
		await deleteBlock(apiKey, block.id);
	}

	if (blocks.length > 0) {
		await appendBlocksInBatches(apiKey, pageId, blocks);
	}

	const updateResponse = await notionFetch(apiKey, `/pages/${pageId}`, {
		method: "PATCH",
		body: JSON.stringify({
			properties: {
				"Drive Modified": {
					date: { start: formatDateForNotion(params.driveModified) },
				},
			},
		}),
	});

	if (!updateResponse.ok) {
		const err = await updateResponse.text();
		throw new Error(`Notion update page failed: ${updateResponse.status} ${err}`);
	}
}
