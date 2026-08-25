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
	{
		id: '1yYHwVo_WGjO2TjYeYNW6sjVfb2iGIm2gYEeRb5IgUr4',
		name: 'KCRP & KCBP Projects Ledger V2',
		access: 'readwrite',
	},
];

export interface ServiceAccountKey {
	kind: 'service_account';
	clientEmail: string;
	privateKey: string;
}

/**
 * OAuth user credentials. The server then acts as the account that granted them,
 * so it sees every sheet that account can see and nothing needs sharing.
 */
export interface OAuthUserKey {
	kind: 'oauth_user';
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}

export type GoogleCredentials = ServiceAccountKey | OAuthUserKey;

export interface Env {
	/** Shared secret, accepted in the URL path or as a bearer token. */
	authToken: string;
	credentials: GoogleCredentials;
	/**
	 * Drive folder ID for "Quotes 2026 S&I". Optional: when unset it is resolved by
	 * folder name at runtime, so no new environment variable is needed.
	 */
	quotesFolderId?: string;
	quotesFolderName: string;
	/** Extra spreadsheet IDs to admit, comma separated. Escape hatch, normally empty. */
	extraSheetIds: string[];
}

/**
 * Every variable the server reads, for the health check to report on. The two
 * service-account forms are alternatives: either the JSON blob, or the split pair.
 */
export const REQUIRED_ENV = [
	'MCP_AUTH_TOKEN',
	'MCP_SHARED_SECRET',
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'GOOGLE_REFRESH_TOKEN',
	'GOOGLE_SERVICE_ACCOUNT_JSON',
	'GOOGLE_SERVICE_ACCOUNT_EMAIL',
	'GOOGLE_PRIVATE_KEY',
	'QUOTES_FOLDER_ID',
	'QUOTES_FOLDER_NAME',
	'EXTRA_SHEET_IDS',
] as const;

function required(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value;
}

function optional(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Two supported credential shapes, checked in the order that costs least to set up.
 *
 * OAuth user credentials come first: the server then acts as the account that
 * granted them and needs nothing shared with it. A service account is the
 * alternative, and needs each sheet plus the quotes folder shared explicitly.
 */
function readCredentials(): GoogleCredentials {
	const refreshToken = optional('GOOGLE_REFRESH_TOKEN');
	if (refreshToken !== undefined) {
		return {
			kind: 'oauth_user',
			clientId: required('GOOGLE_CLIENT_ID'),
			clientSecret: required('GOOGLE_CLIENT_SECRET'),
			refreshToken,
		};
	}

	const blob = optional('GOOGLE_SERVICE_ACCOUNT_JSON');
	if (blob !== undefined) {
		const text = blob.trim().startsWith('{')
			? blob
			: Buffer.from(blob, 'base64').toString('utf8');
		const parsed = JSON.parse(text) as { client_email?: string; private_key?: string };
		if (!parsed.client_email || !parsed.private_key) {
			throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
		}
		return {
			kind: 'service_account',
			clientEmail: parsed.client_email,
			privateKey: normaliseKey(parsed.private_key),
		};
	}

	if (optional('GOOGLE_SERVICE_ACCOUNT_EMAIL') !== undefined) {
		return {
			kind: 'service_account',
			clientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
			privateKey: normaliseKey(required('GOOGLE_PRIVATE_KEY')),
		};
	}

	throw new Error(
		'No Google credentials. Set GOOGLE_REFRESH_TOKEN with GOOGLE_CLIENT_ID and ' +
			'GOOGLE_CLIENT_SECRET, or GOOGLE_SERVICE_ACCOUNT_JSON.',
	);
}

/** Dashboard-pasted keys usually arrive with literal \n rather than real newlines. */
function normaliseKey(key: string): string {
	return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

export function loadEnv(): Env {
	// MCP_SHARED_SECRET is what the previously deployed server used; accepting both
	// means this can replace it without re-entering the secret.
	const authToken = optional('MCP_AUTH_TOKEN') ?? optional('MCP_SHARED_SECRET');
	if (authToken === undefined) {
		throw new Error('Missing required environment variable MCP_AUTH_TOKEN or MCP_SHARED_SECRET');
	}

	return {
		authToken,
		credentials: readCredentials(),
		quotesFolderId: optional('QUOTES_FOLDER_ID'),
		quotesFolderName: optional('QUOTES_FOLDER_NAME') ?? 'Quotes 2026 S&I',
		extraSheetIds: (process.env.EXTRA_SHEET_IDS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s !== ''),
	};
}
