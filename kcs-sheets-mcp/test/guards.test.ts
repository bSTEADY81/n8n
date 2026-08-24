import { beforeEach, describe, expect, it } from 'vitest';

import { parseA1 } from '../src/a1.js';
import { FIXED_SHEETS, type Env } from '../src/config.js';
import {
	assertBoundedWriteRange,
	assertNotProtected,
	assertWritable,
	GuardError,
	resetParentCache,
	resolveSheet,
} from '../src/guards.js';
import type { SheetsClient } from '../src/sheetsClient.js';

const LEDGER = FIXED_SHEETS.find((s) => s.name === 'KCs Ledger 2026')!;
const SCHEDULE = FIXED_SHEETS.find((s) => s.name === 'Project Schedule')!;

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
	extraSheetIds: ['EXTRA_OK'],
};

function fakeClient(parents: Record<string, string[]>): SheetsClient {
	return {
		quotesFolderId: async () => env.quotesFolderId!,
		getParents: async (id: string) => {
			if (!(id in parents)) throw new Error('404 not found');
			return parents[id]!;
		},
	} as unknown as SheetsClient;
}

beforeEach(() => resetParentCache());

describe('resolveSheet — allowlist', () => {
	it('admits the five fixed sheets with their configured access', async () => {
		const client = fakeClient({});
		for (const sheet of FIXED_SHEETS) {
			await expect(resolveSheet(sheet.id, env, client)).resolves.toMatchObject({
				name: sheet.name,
				access: sheet.access,
			});
		}
	});

	it('admits a quote workbook parented to the Quotes folder', async () => {
		const client = fakeClient({ QUOTE_WB: ['FOLDER_QUOTES_2026'] });
		await expect(resolveSheet('QUOTE_WB', env, client)).resolves.toMatchObject({
			access: 'readwrite',
		});
	});

	it('rejects a spreadsheet in some other folder', async () => {
		const client = fakeClient({ RANDOM: ['SOME_OTHER_FOLDER'] });
		await expect(resolveSheet('RANDOM', env, client)).rejects.toBeInstanceOf(GuardError);
	});

	it('rejects rather than widens when Drive errors', async () => {
		const client = fakeClient({});
		await expect(resolveSheet('UNKNOWN', env, client)).rejects.toBeInstanceOf(GuardError);
	});

	it('admits an explicitly allowlisted extra ID without touching Drive', async () => {
		const client = {
			quotesFolderId: async () => env.quotesFolderId!,
			getParents: async () => {
				throw new Error('should not be called');
			},
		} as unknown as SheetsClient;
		await expect(resolveSheet('EXTRA_OK', env, client)).resolves.toMatchObject({
			access: 'readwrite',
		});
	});

	it('caches parentage so repeat calls do not re-hit Drive', async () => {
		let calls = 0;
		const client = {
			quotesFolderId: async () => env.quotesFolderId!,
			getParents: async () => {
				calls += 1;
				return ['FOLDER_QUOTES_2026'];
			},
		} as unknown as SheetsClient;
		await resolveSheet('WB', env, client);
		await resolveSheet('WB', env, client);
		expect(calls).toBe(1);
	});
});

describe('assertWritable — read-only sheets', () => {
	it('blocks writes to Project Schedule', () => {
		expect(() => assertWritable(SCHEDULE)).toThrow(/read-only/);
	});

	it('allows writes to the Ledger', () => {
		expect(() => assertWritable(LEDGER)).not.toThrow();
	});
});

describe('assertBoundedWriteRange — no open ended writes', () => {
	it('accepts a fully pinned range', () => {
		expect(() => assertBoundedWriteRange('Quotes!B12:L12')).not.toThrow();
		expect(() => assertBoundedWriteRange("'Active Pipeline'!A5:H5")).not.toThrow();
		expect(() => assertBoundedWriteRange('Quotes!C7')).not.toThrow();
	});

	it('rejects a bare tab name', () => {
		expect(() => assertBoundedWriteRange('Quotes')).toThrow(/open ended/);
		expect(() => assertBoundedWriteRange("'Job Schedule'")).toThrow(/open ended/);
	});

	it('rejects whole column and whole row ranges', () => {
		expect(() => assertBoundedWriteRange('Quotes!B:L')).toThrow(/open ended/);
		expect(() => assertBoundedWriteRange('Quotes!12:14')).toThrow(/open ended/);
		expect(() => assertBoundedWriteRange('Quotes!A1:L')).toThrow(/open ended/);
	});

	it('rejects a range with no tab', () => {
		expect(() => assertBoundedWriteRange('B12:L12')).toThrow(/does not name a tab/);
	});
});

describe('assertNotProtected — protected columns', () => {
	it('blocks a direct write to Ledger column A', () => {
		expect(() => assertNotProtected(LEDGER, parseA1('Quotes!A12'))).toThrow(/A .*protected/s);
	});

	it('blocks column AE', () => {
		expect(() => assertNotProtected(LEDGER, parseA1('Quotes!AE12'))).toThrow(/AE/);
	});

	it('blocks a span that swallows a protected column', () => {
		expect(() => assertNotProtected(LEDGER, parseA1('Quotes!A12:L12'))).toThrow(/A/);
		expect(() => assertNotProtected(LEDGER, parseA1('Quotes!AA12:AG12'))).toThrow(/AE/);
	});

	it('allows the B to L span the intake skill actually writes', () => {
		expect(() => assertNotProtected(LEDGER, parseA1('Quotes!B12:L12'))).not.toThrow();
	});

	it('only protects the configured tab', () => {
		expect(() => assertNotProtected(LEDGER, parseA1("'Lead Tracker'!A5:C5"))).not.toThrow();
	});

	it('is a no-op for sheets with no protected columns', () => {
		const closer = FIXED_SHEETS.find((s) => s.name === 'The Closer Tracker')!;
		expect(() => assertNotProtected(closer, parseA1("'Active Pipeline'!A5:H5"))).not.toThrow();
	});
});
