/**
 * Recursively traverse a Google shared drive and collect all Google Docs.
 */

import type { DriveFile } from "./google-drive";
import { listFiles } from "./google-drive";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface GoogleDocInfo {
	id: string;
	name: string;
	modifiedTime: string;
	parents?: string[];
}

async function listFilesRecursive(
	accessToken: string,
	driveId: string,
	folderId: string,
	results: GoogleDocInfo[]
): Promise<void> {
	let pageToken: string | undefined;

	do {
		const response = await listFiles(accessToken, {
			driveId,
			folderId,
			pageToken,
		});

		for (const file of response.files) {
			if (file.mimeType === GOOGLE_DOC_MIME) {
				results.push({
					id: file.id,
					name: file.name,
					modifiedTime: file.modifiedTime ?? "",
					parents: file.parents,
				});
			} else if (file.mimeType === FOLDER_MIME) {
				await listFilesRecursive(
					accessToken,
					driveId,
					file.id,
					results
				);
			}
			// Ignore other file types per plan
		}

		pageToken = response.nextPageToken;
	} while (pageToken);
}

/**
 * List all Google Docs in a shared drive, recursively traversing subdirectories.
 * Returns an array of document metadata. Other file types are ignored.
 */
export async function listAllGoogleDocs(
	accessToken: string,
	driveId: string
): Promise<GoogleDocInfo[]> {
	const results: GoogleDocInfo[] = [];
	// For shared drives, the root folder ID equals the drive ID
	await listFilesRecursive(accessToken, driveId, driveId, results);
	return results;
}
