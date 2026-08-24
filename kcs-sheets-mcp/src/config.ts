/**
 * Spreadsheet registry and environment config.
 *
 * The five fixed sheets are pinned by ID. Quote workbooks are created per job so
 * they cannot be listed here; they are admitted by the folder rule in guards.ts
 * instead (any spreadsheet whose Drive parent is the Quotes 2026 S&I folder).
 */

export type Access = 'read' | 'readwrite';

export interface SheetRule {
	id: string;
	name: string;
	access: Access;
	/**
	 * Column letters that sheets_write_cells must never touch on this spreadsheet.
	 * Appends are exempt: they create a new row rather than overwriting a filled one.
	 */
	protectedColumns?: string[];
	/**
	 * Restricts protectedColumns to these tabs. Omit to protect the columns on
	 * every tab of the spreadsheet.
	 */
	protectedTabs?: string[];
}

export const FIXED_SHEETS: SheetRule[] = [
	{
		id: '1sLw8776rK6WEd01gW0Weq-R6bdeAdduaVul8IpojUjQ',
		name: 'KCs Ledger 2026',
		access: 'readwrite',
		// A holds pre-filled quote numbers; AE holds the sheet-generated colour form link.
		protectedColumns: ['A', 'AE'],
		protectedTabs: ['Quotes'],
	},
	{
		id: '14kpETbDJYtbRzIrxAlMMaxW1-cqKJMmPpifcJfwVpU0',
		name: 'Project Schedule',
		access: 'read',
	},
	{
		id: '1D8Z6MNnICnR_KfHc3dXsIRjbx610158li_8SvTED7g0',
		name: 'The Closer Tracker',
		access: 'readwrite',
	},
	{
		id: '1O-ZjfNTdIjiWO7CSeaGyCG7rmkN5_oD0WNhDvuRjoh8',
		name: 'Kevy Training Log',
		access: 'readwrite',
	},
	{
		id: '1LpwYBNFViprmanTLfktP6VMykFyu0-0CPqVtW9Sgb60',
		name: 'Past Projects Update',
		access: 'readwrite',
	},
	{
		id: '1UJLuQ36erDYFNfo-jSHKV8CxIMCUCjAAnInVxG-VlP8',
		name: 'KCs Comms Logbook',
		access: 'readwrite',
	},
];

export interface ServiceAccountKey {
	client_email: string;
	private_key: string;
}

export interface Env {
	/** Shared secret, accepted in the URL path or as a bearer token. */
	authToken: string;
	serviceAccount: ServiceAccountKey;
	/** Drive folder ID for "Quotes 2026 S&I". Quote workbooks are admitted by parentage. */
	quotesFolderId: string;
	/** Extra spreadsheet IDs to admit, comma separated. Escape hatch, normally empty. */
	extraSheetIds: string[];
}

function required(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value;
}

/**
 * Accepts the service account either as the whole downloaded JSON blob
 * (GOOGLE_SERVICE_ACCOUNT_JSON, optionally base64) or as the two fields split out.
 */
function readServiceAccount(): ServiceAccountKey {
	const blob = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (blob !== undefined && blob.trim() !== '') {
		const text = blob.trim().startsWith('{')
			? blob
			: Buffer.from(blob, 'base64').toString('utf8');
		const parsed = JSON.parse(text) as Partial<ServiceAccountKey>;
		if (!parsed.client_email || !parsed.private_key) {
			throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
		}
		return { client_email: parsed.client_email, private_key: normaliseKey(parsed.private_key) };
	}
	return {
		client_email: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
		private_key: normaliseKey(required('GOOGLE_PRIVATE_KEY')),
	};
}

/** Dashboard-pasted keys usually arrive with literal \n rather than real newlines. */
function normaliseKey(key: string): string {
	return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

export function loadEnv(): Env {
	return {
		authToken: required('MCP_AUTH_TOKEN'),
		serviceAccount: readServiceAccount(),
		quotesFolderId: required('QUOTES_FOLDER_ID'),
		extraSheetIds: (process.env.EXTRA_SHEET_IDS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s !== ''),
	};
}
