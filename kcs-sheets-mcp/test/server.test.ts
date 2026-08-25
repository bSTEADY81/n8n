import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import type { Env } from '../src/config.js';
import { createServer } from '../src/server.js';

const env: Env = {
	authToken: 'x',
	credentials: {
		kind: 'oauth_user',
		clientId: 'id',
		clientSecret: 'secret',
		refreshToken: 'refresh',
	},
	quotesFolderId: 'FOLDER_QUOTES_2026',
	quotesFolderName: 'Quotes 2026 S&I',
	// These suites assert the allowlist behaviour, so they opt into it.
	restrictToAllowlist: true,
	extraSheetIds: [],
};

async function connect() {
	const server = createServer(env);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test', version: '1.0.0' });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return { client, server };
}

describe('MCP server wiring', () => {
	it('advertises every tool with schemas over a real MCP session', async () => {
		const { client, server } = await connect();
		const { tools } = await client.listTools();

		expect(tools.map((t) => t.name).sort()).toEqual([
			'sheets_append_row',
			'sheets_find_quote_workbook',
			'sheets_find_row',
			'sheets_list_tabs',
			'sheets_next_blank_row',
			'sheets_read_range',
			'sheets_registry',
			'sheets_write_cells',
		]);

		// sheets_registry takes no arguments and find_quote_workbook resolves an ID
		// rather than accepting one, so neither carries a spreadsheetId.
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			if (tool.name === 'sheets_registry' || tool.name === 'sheets_find_quote_workbook') continue;
			expect(tool.inputSchema.properties).toHaveProperty('spreadsheetId');
		}

		const write = tools.find((t) => t.name === 'sheets_write_cells')!;
		expect(write.annotations?.readOnlyHint).toBe(false);
		expect(tools.find((t) => t.name === 'sheets_read_range')!.annotations?.readOnlyHint).toBe(
			true,
		);

		await client.close();
		await server.close();
	});

	it('does not expose a generic API passthrough tool', async () => {
		const { client, server } = await connect();
		const { tools } = await client.listTools();
		expect(tools.some((t) => /api|request|raw|execute/i.test(t.name))).toBe(false);
		await client.close();
		await server.close();
	});

	it('rejects a call for a spreadsheet outside the allowlist', async () => {
		const { client, server } = await connect();
		const result = await client.callTool({
			name: 'sheets_list_tabs',
			arguments: { spreadsheetId: 'DEFINITELY_NOT_ALLOWED' },
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toMatch(/not on the allowlist/);
		await client.close();
		await server.close();
	});

	it('rejects arguments that fail schema validation', async () => {
		const { client, server } = await connect();
		const result = await client.callTool({
			name: 'sheets_find_row',
			// "FF7" is not a column letter.
			arguments: { spreadsheetId: 'x'.repeat(20), tab: 'Quotes', column: 'FF7', value: 'a' },
		});
		expect(result.isError).toBe(true);
		await client.close();
		await server.close();
	});
});
