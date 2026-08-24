import { beforeEach, describe, expect, it } from 'vitest';

import { FIXED_SHEETS, type Env } from '../src/config.js';
import { resetParentCache } from '../src/guards.js';
import type { CellValue, SheetsClient } from '../src/sheetsClient.js';
import { buildTools } from '../src/tools.js';

const LEDGER = FIXED_SHEETS.find((s) => s.name === 'KCs Ledger 2026')!.id;
const SCHEDULE = FIXED_SHEETS.find((s) => s.name === 'Project Schedule')!.id;
const CLOSER = FIXED_SHEETS.find((s) => s.name === 'The Closer Tracker')!.id;

const env: Env = {
	authToken: 'x',
	serviceAccount: { client_email: 'sa@example.com', private_key: 'key' },
	quotesFolderId: 'FOLDER_QUOTES_2026',
	extraSheetIds: [],
};

interface Calls {
	batchGet: Array<{ ranges: string[]; render: string }>;
	batchUpdate: Array<{ data: unknown; valueInputOption: string }>;
	append: Array<{ range: string; values: CellValue[][] }>;
	findWorkbooks: string[];
}

function harness(options: {
	column?: CellValue[][];
	tabs?: Array<{ title: string }>;
	appendRange?: string;
	updatedRanges?: string[];
	workbooks?: Array<{ id: string; name: string; modifiedTime: string }>;
}) {
	const calls: Calls = { batchGet: [], batchUpdate: [], append: [], findWorkbooks: [] };
	const client = {
		getParents: async () => ['SOME_OTHER_FOLDER'],
		findQuoteWorkbooks: async (_folder: string, nameContains: string) => {
			calls.findWorkbooks.push(nameContains);
			return options.workbooks ?? [];
		},
		listTabs: async () => ({ title: 'Book', tabs: options.tabs ?? [] }),
		batchGet: async (_id: string, ranges: string[], render: string) => {
			calls.batchGet.push({ ranges, render });
			return ranges.map((range) => ({ range, values: options.column ?? [] }));
		},
		batchUpdate: async (_id: string, data: unknown, valueInputOption: string) => {
			calls.batchUpdate.push({ data, valueInputOption });
			return {
				totalUpdatedCells: 11,
				updatedRanges: options.updatedRanges ?? ['Quotes!B12:L12'],
			};
		},
		append: async (_id: string, range: string, values: CellValue[][]) => {
			calls.append.push({ range, values });
			return { updatedRange: options.appendRange ?? "'Active Pipeline'!A47:H47", updatedRows: 1 };
		},
	} as unknown as SheetsClient;

	const tools = buildTools({ env, client });
	const byName = new Map(tools.map((t) => [t.name, t]));
	const call = async (name: string, args: unknown) => {
		const tool = byName.get(name);
		if (!tool) throw new Error(`no tool ${name}`);
		return (await (tool.handler as (a: unknown) => Promise<any>)(args)) as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
	};
	const json = async (name: string, args: unknown) => {
		const result = await call(name, args);
		expect(result.isError).toBeFalsy();
		return JSON.parse(result.content[0]!.text);
	};
	const error = async (name: string, args: unknown) => {
		const result = await call(name, args);
		expect(result.isError).toBe(true);
		return result.content[0]!.text;
	};
	return { calls, json, error, tools };
}

beforeEach(() => resetParentCache());

describe('tool surface', () => {
	it('exposes the six spec tools plus the two the deployed server added', () => {
		const { tools } = harness({});
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
	});
});

describe('sheets_registry', () => {
	it('lists every allowlisted sheet with its access', async () => {
		const { json } = harness({});
		const out = await json('sheets_registry', {});
		expect(out.sheets.map((s: { name: string }) => s.name)).toContain('KCs Comms Logbook');
		expect(out.sheets).toHaveLength(6);
	});

	it('marks Project Schedule read only', async () => {
		const { json } = harness({});
		const out = await json('sheets_registry', {});
		const schedule = out.sheets.find((s: { name: string }) => s.name === 'Project Schedule');
		expect(schedule.access).toBe('read');
	});

	it('discloses protected columns so a caller does not plan a doomed write', async () => {
		const { json } = harness({});
		const out = await json('sheets_registry', {});
		const ledger = out.sheets.find((s: { name: string }) => s.name === 'KCs Ledger 2026');
		expect(ledger.protectedColumns).toEqual(['A', 'AE']);
		expect(ledger.protectedTabs).toEqual(['Quotes']);
	});

	it('names the write tools it advertises access for', async () => {
		const { json } = harness({});
		const out = await json('sheets_registry', {});
		// The deployed server reported access:write while exposing no write tool at all.
		expect(out.writeTools).toEqual(['sheets_write_cells', 'sheets_append_row']);
	});
});

describe('sheets_find_quote_workbook', () => {
	it('returns matches from the quotes folder', async () => {
		const { json } = harness({
			workbooks: [{ id: 'WB1', name: 'Q7418 Smith', modifiedTime: '2026-08-01T00:00:00Z' }],
		});
		const out = await json('sheets_find_quote_workbook', { nameContains: 'Q7418' });
		expect(out.matchCount).toBe(1);
		expect(out.workbooks[0].id).toBe('WB1');
	});

	it('reports a miss without pretending', async () => {
		const { json } = harness({ workbooks: [] });
		const out = await json('sheets_find_quote_workbook', { nameContains: 'Q9999' });
		expect(out.matchCount).toBe(0);
		expect(out.note).toMatch(/No workbook/);
	});
});

describe('the Comms Logbook', () => {
	it('is writable now it is on the allowlist', async () => {
		const { json } = harness({ appendRange: 'Log!A72:F72' });
		const out = await json('sheets_append_row', {
			spreadsheetId: '1UJLuQ36erDYFNfo-jSHKV8CxIMCUCjAAnInVxG-VlP8',
			tab: 'Log',
			values: ['2026-08-24', 'confirmed'],
		});
		expect(out.row).toBe(72);
		expect(out.spreadsheetName).toBe('KCs Comms Logbook');
	});

	it('is readable', async () => {
		const { json } = harness({ tabs: [{ title: 'Log' }] });
		const out = await json('sheets_list_tabs', {
			spreadsheetId: '1UJLuQ36erDYFNfo-jSHKV8CxIMCUCjAAnInVxG-VlP8',
		});
		expect(out.access).toBe('readwrite');
	});
});

describe('sheets_list_tabs', () => {
	it('rejects a spreadsheet that is not allowlisted', async () => {
		const { error } = harness({});
		expect(await error('sheets_list_tabs', { spreadsheetId: 'RANDOM_ID_12345' })).toMatch(
			/not on the allowlist/,
		);
	});

	it('returns tabs for an allowlisted sheet', async () => {
		const { json } = harness({ tabs: [{ title: 'PO 1' }, { title: 'TAKE OFF' }] });
		const out = await json('sheets_list_tabs', { spreadsheetId: LEDGER });
		expect(out.tabs.map((t: { title: string }) => t.title)).toEqual(['PO 1', 'TAKE OFF']);
	});
});

describe('sheets_read_range', () => {
	it('maps render=FORMULA onto the FORMULA render option', async () => {
		const { calls, json } = harness({ column: [['=SUM(A1:A2)']] });
		await json('sheets_read_range', {
			spreadsheetId: LEDGER,
			ranges: ['Quotes!A1:B2'],
			render: 'FORMULA',
		});
		expect(calls.batchGet[0]!.render).toBe('FORMULA');
	});

	it('defaults to displayed values', async () => {
		const { calls, json } = harness({});
		await json('sheets_read_range', { spreadsheetId: LEDGER, ranges: ['Quotes!A1:B2'] });
		expect(calls.batchGet[0]!.render).toBe('FORMATTED_VALUE');
	});

	it('allows an open-ended read range', async () => {
		const { json } = harness({});
		await expect(
			json('sheets_read_range', { spreadsheetId: LEDGER, ranges: ['Quotes!A1:L'] }),
		).resolves.toBeTruthy();
	});
});

describe('sheets_find_row', () => {
	const column: CellValue[][] = [
		['jim@example.com'],
		[''],
		['Kate@Example.com'],
		['someone@else.com'],
		['kate@example.com'],
	];

	it('matches case-insensitively and returns the first hit by default', async () => {
		const { json } = harness({ column });
		const out = await json('sheets_find_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'F',
			value: 'KATE@example.com',
		});
		expect(out.found).toBe(true);
		expect(out.row).toBe(3);
		expect(out.matchCount).toBe(2);
		expect(out.allMatchRows).toEqual([3, 5]);
	});

	it('returns the last hit for direction=bottom', async () => {
		const { json } = harness({ column });
		const out = await json('sheets_find_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'F',
			value: 'kate@example.com',
			direction: 'bottom',
		});
		expect(out.row).toBe(5);
	});

	it('honours exact matching', async () => {
		const { json } = harness({ column });
		const out = await json('sheets_find_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'F',
			value: 'Kate@Example.com',
			match: 'exact',
		});
		expect(out.matchCount).toBe(1);
		expect(out.row).toBe(3);
	});

	it('supports substring matching', async () => {
		const { json } = harness({ column });
		const out = await json('sheets_find_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'F',
			value: '@else.com',
			match: 'contains',
		});
		expect(out.row).toBe(4);
	});

	it('offsets rows by startRow', async () => {
		const { calls, json } = harness({ column });
		const out = await json('sheets_find_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'F',
			value: 'someone@else.com',
			startRow: 100,
		});
		expect(out.row).toBe(103);
		expect(calls.batchGet[0]!.ranges[0]).toBe('Quotes!F100:F5099');
	});

	it('quotes a tab name with a space', async () => {
		const { calls, json } = harness({ column: [] });
		await json('sheets_find_row', {
			spreadsheetId: CLOSER,
			tab: 'Active Pipeline',
			column: 'A',
			value: 'Q7203',
		});
		expect(calls.batchGet[0]!.ranges[0]).toBe("'Active Pipeline'!A1:A5000");
	});

	it('reports a miss cleanly', async () => {
		const { json } = harness({ column });
		const out = await json('sheets_find_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'F',
			value: 'nobody@nowhere.com',
		});
		expect(out.found).toBe(false);
		expect(out.row).toBeNull();
	});
});

describe('sheets_next_blank_row', () => {
	it('finds an interior blank', async () => {
		const { json } = harness({ column: [['a'], ['b'], [''], ['d']] });
		const out = await json('sheets_next_blank_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'B',
			startRow: 2,
		});
		expect(out.row).toBe(4);
	});

	it('lands past the last filled row when Sheets truncates trailing blanks', async () => {
		const { json } = harness({ column: [['a'], ['b'], ['c']] });
		const out = await json('sheets_next_blank_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'B',
			startRow: 2,
		});
		expect(out.row).toBe(5);
		expect(out.lastFilledRow).toBe(4);
	});

	it('treats whitespace as blank', async () => {
		const { json } = harness({ column: [['a'], ['   ']] });
		const out = await json('sheets_next_blank_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'B',
			startRow: 10,
		});
		expect(out.row).toBe(11);
	});

	it('returns the start row when the column is empty', async () => {
		const { json } = harness({ column: [] });
		const out = await json('sheets_next_blank_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'B',
			startRow: 2,
		});
		expect(out.row).toBe(2);
		expect(out.lastFilledRow).toBeNull();
	});

	it('flags a fully packed scan window rather than guessing', async () => {
		const column = Array.from({ length: 5000 }, (_, i) => [`row${i}`]);
		const { json } = harness({ column });
		const out = await json('sheets_next_blank_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			column: 'B',
			startRow: 2,
		});
		expect(out.row).toBeNull();
		expect(out.scanTruncated).toBe(true);
	});
});

describe('sheets_write_cells', () => {
	const good = { range: 'Quotes!B12:L12', values: [Array.from({ length: 11 }, () => 'x')] };

	it('writes and returns the row number', async () => {
		const { json } = harness({ updatedRanges: ['Quotes!B12:L12'] });
		const out = await json('sheets_write_cells', { spreadsheetId: LEDGER, updates: [good] });
		expect(out.written[0].row).toBe(12);
		expect(out.written[0].updatedRange).toBe('Quotes!B12:L12');
	});

	it('defaults to USER_ENTERED', async () => {
		const { calls, json } = harness({});
		await json('sheets_write_cells', { spreadsheetId: LEDGER, updates: [good] });
		expect(calls.batchUpdate[0]!.valueInputOption).toBe('USER_ENTERED');
	});

	it('refuses the read-only Project Schedule', async () => {
		const { error } = harness({});
		expect(
			await error('sheets_write_cells', {
				spreadsheetId: SCHEDULE,
				updates: [{ range: "'Job Schedule'!B2:C2", values: [['a', 'b']] }],
			}),
		).toMatch(/read-only/);
	});

	it('refuses an open-ended range', async () => {
		const { error } = harness({});
		expect(
			await error('sheets_write_cells', {
				spreadsheetId: LEDGER,
				updates: [{ range: 'Quotes', values: [['a']] }],
			}),
		).toMatch(/open ended/);
	});

	it('refuses a protected column', async () => {
		const { error } = harness({});
		expect(
			await error('sheets_write_cells', {
				spreadsheetId: LEDGER,
				updates: [{ range: 'Quotes!AE12', values: [['link']] }],
			}),
		).toMatch(/AE/);
	});

	it('refuses values that overflow the declared range', async () => {
		const { error } = harness({});
		expect(
			await error('sheets_write_cells', {
				spreadsheetId: LEDGER,
				updates: [{ range: 'Quotes!B12:D12', values: [['a', 'b', 'c', 'd']] }],
			}),
		).toMatch(/1x3 but the values are 1x4/);
	});

	it('rejects the whole batch when one range is bad', async () => {
		const { calls, error } = harness({});
		await error('sheets_write_cells', {
			spreadsheetId: LEDGER,
			updates: [good, { range: 'Quotes!A12', values: [['tampered']] }],
		});
		expect(calls.batchUpdate).toHaveLength(0);
	});
});

describe('sheets_append_row', () => {
	it('appends and returns the landing row', async () => {
		const { calls, json } = harness({ appendRange: "'Active Pipeline'!A47:H47" });
		const out = await json('sheets_append_row', {
			spreadsheetId: CLOSER,
			tab: 'Active Pipeline',
			values: ['Q7203', 'Smith', 'Apollo'],
		});
		expect(out.row).toBe(47);
		expect(out.lastColumn).toBe('C');
		expect(calls.append[0]!.range).toBe("'Active Pipeline'");
	});

	it('refuses the read-only Project Schedule', async () => {
		const { error } = harness({});
		expect(
			await error('sheets_append_row', {
				spreadsheetId: SCHEDULE,
				tab: 'Job Schedule',
				values: ['x'],
			}),
		).toMatch(/read-only/);
	});

	it('is not blocked by the Ledger protected columns', async () => {
		const { json } = harness({ appendRange: 'Quotes!A1800:L1800' });
		const out = await json('sheets_append_row', {
			spreadsheetId: LEDGER,
			tab: 'Quotes',
			values: ['Q7300', 'Smith'],
		});
		expect(out.row).toBe(1800);
	});
});
