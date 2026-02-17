/**
 * Drive-to-Notion sync Worker.
 * Cron-triggered: recursively traverses a Google shared drive, exports Google Docs
 * to markdown, and upserts them into a Notion database with change detection.
 */

import { listAllGoogleDocs } from "./lib/drive-traversal";
import {
	exportAsMarkdown,
	getAccessToken,
	getDriveMetadata,
	listDrives,
	parseServiceAccountJson,
} from "./lib/google-drive";
import {
	createPage,
	queryDatabaseByDriveId,
	updatePage,
} from "./lib/notion";

async function runSync(env: Env): Promise<{ synced: number; skipped: number; failed: number }> {
	const credentials = parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);

	console.log("[sync] Getting JWT access token...");
	const accessToken = await getAccessToken(
		credentials,
		env.GOOGLE_IMPERSONATE_USER
	);
	console.log("[sync] JWT access token obtained");

	console.log("[sync] Listing Google Docs from drive...");
	const docs = await listAllGoogleDocs(accessToken, env.GOOGLE_DRIVE_SHARED_DRIVE_ID);
	console.log(`[sync] Found ${docs.length} Google Doc(s), processing...`);

	let synced = 0;
	let skipped = 0;
	let failed = 0;

	for (const doc of docs) {
		try {
			const existing = await queryDatabaseByDriveId(
				env.NOTION_API_KEY,
				env.NOTION_DATABASE_ID,
				doc.id
			);

			const driveModified = doc.modifiedTime;

			if (existing) {
				const storedModified = existing.properties["Drive Modified"]?.date?.start;
				if (storedModified && storedModified === driveModified) {
					skipped++;
					continue;
				}
			}

			const markdown = await exportAsMarkdown(accessToken, doc.id);

			if (existing) {
				await updatePage(env.NOTION_API_KEY, existing.id, {
					markdown,
					driveModified,
				});
				console.log(`[sync] Notion page updated: ${doc.name}`);
			} else {
				await createPage(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, {
					title: doc.name,
					driveFileId: doc.id,
					driveModified,
					markdown,
				});
				console.log(`[sync] Notion page created: ${doc.name}`);
			}
			synced++;
		} catch (err) {
			console.error(`Failed to sync ${doc.name} (${doc.id}):`, err);
			failed++;
		}
	}

	return { synced, skipped, failed };
}

export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/debug-drive-list") {
			try {
				const credentials = parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);
				const accessToken = await getAccessToken(
					credentials,
					env.GOOGLE_IMPERSONATE_USER
				);
				const useDomainAdmin = url.searchParams.get("useDomainAdmin") === "true";
				const drives = await listDrives(accessToken, {
					useDomainAdminAccess: useDomainAdmin,
				});
				const configuredId = env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
				const match = drives.find((d) => d.id === configuredId);

				return new Response(
					JSON.stringify({
						ok: true,
						configuredDriveId: configuredId,
						configuredIdInList: match !== undefined,
						drives: drives.map((d) => ({
							id: d.id,
							name: d.name,
							isConfigured: d.id === configuredId,
						})),
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return new Response(
					JSON.stringify({ ok: false, error: message }),
					{ status: 500, headers: { "Content-Type": "application/json" } }
				);
			}
		}
		if (url.pathname === "/debug-drive") {
			try {
				const credentials = parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);
				const accessToken = await getAccessToken(
					credentials,
					env.GOOGLE_IMPERSONATE_USER
				);
				const useDomainAdmin = url.searchParams.get("useDomainAdmin") === "true";

				let drive: { id: string; name: string };
				try {
					drive = await getDriveMetadata(
						accessToken,
						env.GOOGLE_DRIVE_SHARED_DRIVE_ID,
						{ useDomainAdminAccess: useDomainAdmin }
					);
				} catch (firstErr) {
					// If 404 without useDomainAdmin, retry with it (pc@ may be Workspace admin)
					if (!useDomainAdmin) {
						try {
							drive = await getDriveMetadata(
								accessToken,
								env.GOOGLE_DRIVE_SHARED_DRIVE_ID,
								{ useDomainAdminAccess: true }
							);
							return new Response(
								JSON.stringify({
									ok: true,
									drive: { id: drive.id, name: drive.name },
									message: "Drive accessible with useDomainAdminAccess=true.",
								}),
								{ status: 200, headers: { "Content-Type": "application/json" } }
							);
						} catch {
							// Fall through to original error
						}
					}
					throw firstErr;
				}

				return new Response(
					JSON.stringify({
						ok: true,
						drive: { id: drive.id, name: drive.name },
						message: "Drive accessible. Impersonation and shared drive access OK.",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					}
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return new Response(
					JSON.stringify({ ok: false, error: message }),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
		}
		if (url.pathname === "/sync") {
			try {
				const result = await runSync(env);
				const message = `Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed`;
				console.log(`[sync] ${message}`);
				return new Response(
					JSON.stringify({
						ok: true,
						synced: result.synced,
						skipped: result.skipped,
						failed: result.failed,
						message,
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					}
				);
			} catch (err) {
				console.error("[sync] Manual sync failed:", err);
				return new Response(
					JSON.stringify({
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					}
				);
			}
		}

		return new Response(
			"Drive-to-Notion sync. Endpoints: GET /sync, GET /debug-drive (verify drive), GET /debug-drive-list (list accessible drives).",
			{
				status: 200,
				headers: { "Content-Type": "text/plain" },
			}
		);
	},

	async scheduled(
		_controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext
	): Promise<void> {
		ctx.waitUntil(
			runSync(env)
				.then((result) => {
					console.log(
						`Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed`
					);
				})
				.catch((err) => {
					console.error("Sync failed:", err);
				})
		);
	},
} satisfies ExportedHandler<Env>;
