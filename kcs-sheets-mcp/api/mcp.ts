import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isAuthorised } from '../src/auth.js';
import { loadEnv, REQUIRED_ENV } from '../src/config.js';
import { createServer } from '../src/server.js';

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
