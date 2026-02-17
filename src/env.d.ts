declare global {
	interface Env {
		GOOGLE_SERVICE_ACCOUNT_JSON: string;
		GOOGLE_IMPERSONATE_USER: string;
		GOOGLE_DRIVE_SHARED_DRIVE_ID: string;
		NOTION_API_KEY: string;
		NOTION_DATABASE_ID: string;
	}
}
export {};
