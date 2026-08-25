import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isAuthorised } from '../src/auth.js';
import { loadEnv, REQUIRED_ENV } from '../src/config.js';
import { getAccessToken } from '../src/googleAuth.js';
import { createServer } from '../src/server.js';

/**
 * What Google actually granted, asked of Google rather than assumed. Whether the
 * credentials carry write scope decides if sheets_write_cells and
 * sheets_append_row can work at all, and the alternative way to find out is to
 * attempt a write against a live sheet.
 */
async function describeGrant(): Promise<Record<string, unknown>> {
	try {
		const env = loadEnv();
		const token = await getAccessToken(env.credentials);
		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
		);
		if (!response.ok) {
			return { kind: env.credentials.kind, error: `tokeninfo returned ${response.status}` };
		}
		const info = (await response.json()) as { scope?: string; email?: string };
		const scopes = (info.scope ?? '').split(' ').filter(Boolean);

		// tokeninfo only returns an email when the userinfo scopes were consented,
		// which they were not. Drive's about endpoint names the account under the
		// drive scope we do have, and which account this is decides which Drive
		// "every spreadsheet" actually means.
		let account = info.email;
		if (account === undefined) {
			const about = await fetch(
				'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
				{ headers: { authorization: `Bearer ${token}` } },
			);
			if (about.ok) {
				const json = (await about.json()) as { user?: { emailAddress?: string } };
				account = json.user?.emailAddress;
			}
		}

		return {
			kind: env.credentials.kind,
			account,
			scopes,
			// The read-only scope cannot write, and neither can the absence of both.
			canWriteSheets: scopes.includes('https://www.googleapis.com/auth/spreadsheets'),
			// drive.readonly cannot create files, so there is no way to make a new
			// spreadsheet — only to write into ones that already exist.
			canCreateSpreadsheets: false,
		};
	} catch (error) {
		return { error: (error as Error).message };
	}
}

/**
 * Stateless streamable HTTP. Every invocation builds its own server and transport
 * and tears them down when the response closes, because a serverless instance is
 * not guaranteed to see the next request in a session.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
	// Auth is checked against MCP_AUTH_TOKEN alone, before the rest of the config
	// is read. Loading everything up front would report which Google variables are
	// missing to callers who have not authenticated yet.
	const expected = process.env.MCP_AUTH_TOKEN ?? process.env.MCP_SHARED_SECRET;
	if (expected === undefined || expected.trim() === '') {
		res.status(500).json({ error: 'Server misconfigured' });
		return;
	}

	const authorised = isAuthorised(
		{
			// "k" is what the connector configured before this server was written uses.
			queryTokens: [req.query?.token, req.query?.k],
			authorizationHeader: req.headers.authorization,
			customHeader: req.headers['x-mcp-token'],
		},
		expected,
	);

	if (!authorised) {
		// No WWW-Authenticate header: this is a shared secret, not an OAuth resource,
		// and advertising a challenge would send clients down a discovery path.
		res.status(401).json({ error: 'Unauthorized' });
		return;
	}

	// Names and presence only, never values. Makes a redeploy onto an existing
	// project diagnosable in one call when the env var names may not match.
	if (req.query?.health !== undefined) {
		res.status(200).json({
			ok: true,
			server: 'kcs-sheets',
			env: Object.fromEntries(
				REQUIRED_ENV.map((name) => [name, (process.env[name] ?? '').trim() !== '']),
			),
			google: await describeGrant(),
		});
		return;
	}

	let env;
	try {
		env = loadEnv();
	} catch (error) {
		res.status(500).json({ error: `Server misconfigured: ${(error as Error).message}` });
		return;
	}

	const server = createServer(env);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	res.on('close', () => {
		void transport.close();
		void server.close();
	});

	try {
		await server.connect(transport);
		await transport.handleRequest(req, res, req.body);
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({
				jsonrpc: '2.0',
				error: { code: -32603, message: (error as Error).message },
				id: null,
			});
		}
	}
}
