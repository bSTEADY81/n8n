import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config.js';

const KEYS = [
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
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('the shared secret', () => {
	it('accepts MCP_SHARED_SECRET, which is what the deployed server used', () => {
		process.env.MCP_SHARED_SECRET = 'secret';
		process.env.GOOGLE_REFRESH_TOKEN = 'r';
		process.env.GOOGLE_CLIENT_ID = 'i';
		process.env.GOOGLE_CLIENT_SECRET = 's';
		expect(loadEnv().authToken).toBe('secret');
	});

	it('prefers MCP_AUTH_TOKEN when both are set', () => {
		process.env.MCP_AUTH_TOKEN = 'preferred';
		process.env.MCP_SHARED_SECRET = 'other';
		process.env.GOOGLE_REFRESH_TOKEN = 'r';
		process.env.GOOGLE_CLIENT_ID = 'i';
		process.env.GOOGLE_CLIENT_SECRET = 's';
		expect(loadEnv().authToken).toBe('preferred');
	});

	it('names both when neither is set', () => {
		process.env.GOOGLE_REFRESH_TOKEN = 'r';
		process.env.GOOGLE_CLIENT_ID = 'i';
		process.env.GOOGLE_CLIENT_SECRET = 's';
		expect(() => loadEnv()).toThrow(/MCP_AUTH_TOKEN or MCP_SHARED_SECRET/);
	});
});

describe('Google credentials', () => {
	beforeEach(() => {
		process.env.MCP_SHARED_SECRET = 'secret';
	});

	it('uses the OAuth refresh token when one is present', () => {
		process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
		process.env.GOOGLE_CLIENT_ID = 'id';
		process.env.GOOGLE_CLIENT_SECRET = 'sec';
		expect(loadEnv().credentials).toEqual({
			kind: 'oauth_user',
			clientId: 'id',
			clientSecret: 'sec',
			refreshToken: 'refresh',
		});
	});

	it('says which half of the OAuth trio is missing', () => {
		process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
		expect(() => loadEnv()).toThrow(/GOOGLE_CLIENT_ID/);
	});

	it('falls back to a service account JSON blob', () => {
		process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
			client_email: 'sa@example.com',
			private_key: 'KEY',
		});
		expect(loadEnv().credentials).toEqual({
			kind: 'service_account',
			clientEmail: 'sa@example.com',
			privateKey: 'KEY',
		});
	});

	it('accepts that blob base64 encoded', () => {
		process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(
			JSON.stringify({ client_email: 'sa@example.com', private_key: 'KEY' }),
		).toString('base64');
		expect(loadEnv().credentials).toMatchObject({ clientEmail: 'sa@example.com' });
	});

	it('turns literal \\n in a pasted private key into real newlines', () => {
		process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@example.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN-----\\nline\\n-----END-----';
		const creds = loadEnv().credentials;
		expect(creds.kind).toBe('service_account');
		if (creds.kind === 'service_account') {
			expect(creds.privateKey).toBe('-----BEGIN-----\nline\n-----END-----');
		}
	});

	it('refuses to start with no credentials at all, naming both options', () => {
		expect(() => loadEnv()).toThrow(/GOOGLE_REFRESH_TOKEN.*GOOGLE_SERVICE_ACCOUNT_JSON/s);
	});
});

describe('the quotes folder', () => {
	beforeEach(() => {
		process.env.MCP_SHARED_SECRET = 'secret';
		process.env.GOOGLE_REFRESH_TOKEN = 'r';
		process.env.GOOGLE_CLIENT_ID = 'i';
		process.env.GOOGLE_CLIENT_SECRET = 's';
	});

	it('is optional, so a deployment without QUOTES_FOLDER_ID still starts', () => {
		const env = loadEnv();
		expect(env.quotesFolderId).toBeUndefined();
		expect(env.quotesFolderName).toBe('Quotes 2026 S&I');
	});

	it('uses the ID when it is configured', () => {
		process.env.QUOTES_FOLDER_ID = 'FOLDER';
		expect(loadEnv().quotesFolderId).toBe('FOLDER');
	});
});
