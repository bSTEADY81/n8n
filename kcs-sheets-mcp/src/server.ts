import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadEnv, type Env } from './config.js';
import { SheetsClient } from './sheetsClient.js';
import { buildTools } from './tools.js';

export const SERVER_INFO = { name: 'kcs-sheets', version: '1.0.0' } as const;

/**
 * A fresh server per request. The Vercel handler runs the transport statelessly,
 * so there is no session to keep alive between invocations.
 */
export function createServer(env: Env = loadEnv()): McpServer {
	const server = new McpServer(SERVER_INFO, {
		instructions:
			'Scoped Google Sheets access for the KC\'s skills. Six tools, no generic API passthrough. ' +
			'Reads accept open-ended ranges; writes must name a tab and pin both corners of the range. ' +
			'Prefer sheets_find_row and sheets_next_blank_row over reading blocks of rows and scanning ' +
			'them yourself — they do the scan server side and return a row number. ' +
			'Every write returns the row it landed on; re-read that row when placement matters.',
	});

	const client = new SheetsClient(env);
	for (const tool of buildTools({ env, client })) {
		// The SDK's generic inference does not survive the array round trip; the
		// per-tool handlers are typed against their own schemas in tools.ts.
		server.registerTool(tool.name, tool.config as never, tool.handler as never);
	}

	return server;
}
