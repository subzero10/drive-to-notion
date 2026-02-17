/**
 * Google Drive API client with domain-wide delegation (service account impersonation).
 * Uses JWT-based auth to obtain access tokens, then calls Drive API.
 */

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/** List shared drives the impersonated user can access. Use to verify correct drive ID. */
export async function listDrives(
	accessToken: string,
	options?: { useDomainAdminAccess?: boolean }
): Promise<Array<{ id: string; name: string }>> {
	const params = new URLSearchParams({
		pageSize: "100",
		fields: "drives(id,name),nextPageToken",
	});
	if (options?.useDomainAdminAccess) {
		params.set("useDomainAdminAccess", "true");
	}
	const url = `${DRIVE_API_BASE}/drives?${params.toString()}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`drives.list failed: ${response.status} ${err}`);
	}

	const data = (await response.json()) as {
		drives?: Array<{ id: string; name: string }>;
		nextPageToken?: string;
	};
	return data.drives ?? [];
}

/** Verify access to a shared drive. Useful for debugging 404s. */
export async function getDriveMetadata(
	accessToken: string,
	driveId: string,
	options?: { useDomainAdminAccess?: boolean }
): Promise<{ id: string; name: string }> {
	const params = options?.useDomainAdminAccess
		? "?useDomainAdminAccess=true"
		: "";
	const url = `${DRIVE_API_BASE}/drives/${driveId}${params}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		const err = await response.text();
		let parsed: { error?: { message?: string; code?: number } } = {};
		try {
			parsed = JSON.parse(err) as typeof parsed;
		} catch {
			// not JSON
		}
		const detail = parsed.error?.message ?? err;
		console.error("[Drive API] drives.get failed:", { status: response.status, url, body: err });
		throw new Error(`Drive not found or no access: ${response.status} ${detail}`);
	}

	const data = (await response.json()) as { id: string; name: string };
	return { id: data.id, name: data.name };
}

export interface ServiceAccountCredentials {
	client_email: string;
	private_key: string;
	client_id?: string;
}

export interface GoogleDriveEnv {
	GOOGLE_SERVICE_ACCOUNT_JSON: string;
	GOOGLE_IMPERSONATE_USER: string;
	GOOGLE_DRIVE_SHARED_DRIVE_ID: string;
}

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime: string;
	parents?: string[];
}

export interface DriveFileListResponse {
	files: DriveFile[];
	nextPageToken?: string;
}

function base64UrlEncode(data: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...data));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(
	privateKeyPem: string,
	header: Record<string, string>,
	payload: Record<string, string | number>
): Promise<string> {
	const encoder = new TextEncoder();

	// Parse PEM - extract base64 content between headers
	const pemContents = privateKeyPem
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s/g, "");

	const binaryDer = Uint8Array.from(atob(pemContents), (c) =>
		c.charCodeAt(0)
	);

	const cryptoKey = await crypto.subtle.importKey(
		"pkcs8",
		binaryDer,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"]
	);

	const headerB64 = base64UrlEncode(
		encoder.encode(JSON.stringify(header))
	);
	const payloadB64 = base64UrlEncode(
		encoder.encode(JSON.stringify(payload))
	);
	const message = `${headerB64}.${payloadB64}`;

	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		encoder.encode(message)
	);

	const signatureB64 = base64UrlEncode(new Uint8Array(signature));
	return `${message}.${signatureB64}`;
}

export async function getAccessToken(
	credentials: ServiceAccountCredentials,
	impersonateUser: string
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iss: credentials.client_email,
		sub: impersonateUser,
		scope: DRIVE_SCOPE,
		aud: TOKEN_URL,
		iat: now,
		exp: now + 3600,
	};

	const jwt = await signJwt(
		credentials.private_key,
		{ alg: "RS256", typ: "JWT" },
		payload
	);

	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}).toString(),
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Failed to get access token: ${response.status} ${err}`);
	}

	const data = (await response.json()) as { access_token: string };
	return data.access_token;
}

export interface ListFilesParams {
	driveId: string;
	folderId?: string;
	pageToken?: string;
}

export async function listFiles(
	accessToken: string,
	params: ListFilesParams
): Promise<DriveFileListResponse> {
	const searchParams = new URLSearchParams({
		corpora: "drive",
		driveId: params.driveId,
		includeItemsFromAllDrives: "true",
		supportsAllDrives: "true",
		q: params.folderId
			? `'${params.folderId}' in parents and trashed = false`
			: `'${params.driveId}' in parents and trashed = false`,
		fields: "nextPageToken,files(id,name,mimeType,modifiedTime,parents)",
	});

	if (params.pageToken) {
		searchParams.set("pageToken", params.pageToken);
	}

	const url = `${DRIVE_API_BASE}/files?${searchParams.toString()}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		const err = await response.text();
		console.error("[Drive API] listFiles failed:", { status: response.status, url, body: err });
		throw new Error(`Drive listFiles failed: ${response.status} ${err}`);
	}

	return (await response.json()) as DriveFileListResponse;
}

export async function exportAsMarkdown(
	accessToken: string,
	fileId: string
): Promise<string> {
	const url = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text%2Fmarkdown`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Drive export failed for ${fileId}: ${response.status} ${err}`);
	}

	return response.text();
}

export function parseServiceAccountJson(json: string): ServiceAccountCredentials {
	const parsed = JSON.parse(json) as {
		client_email?: string;
		private_key?: string;
		client_id?: string;
	};
	if (!parsed.client_email || !parsed.private_key) {
		throw new Error("Invalid service account JSON: missing client_email or private_key");
	}
	return {
		client_email: parsed.client_email,
		private_key: parsed.private_key.replace(/\\n/g, "\n"),
		client_id: parsed.client_id,
	};
}
