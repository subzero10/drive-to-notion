import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Drive-to-Notion worker', () => {
	it('responds with sync info (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(
			`"Drive-to-Notion sync. Endpoints: GET /sync, GET /debug-drive (verify drive), GET /debug-drive-list (list accessible drives)."`
		);
	});

	it('responds with sync info (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(await response.text()).toMatchInlineSnapshot(
			`"Drive-to-Notion sync. Endpoints: GET /sync, GET /debug-drive (verify drive), GET /debug-drive-list (list accessible drives)."`
		);
	});
});
