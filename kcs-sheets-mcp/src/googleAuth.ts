import { createSign } from 'node:crypto';

import type { ServiceAccountKey } from './config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Sheets for the data, Drive metadata so the folder rule in guards.ts can check
 * a quote workbook's parent. Both are read-shaped scopes at the API level; what
 * the service account can actually write is decided by the sharing on each file.
 */
export const SCOPES = [
	'https://www.googleapis.com/auth/spreadsheets',
	'https://www.googleapis.com/auth/drive.metadata.readonly',
].join(' ');

interface CachedToken {
	token: string;
	expiresAt: number;
}

/** Per-instance cache. Serverless instances are reused, so this saves a token round trip. */
let cache: CachedToken | undefined;

function base64url(input: Buffer | string): string {
	return Buffer.from(input)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function buildAssertion(sa: ServiceAccountKey, now: number): string {
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({
			iss: sa.client_email,
			scope: SCOPES,
			aud: TOKEN_URL,
			iat: now,
			exp: now + 3600,
		}),
	);
	const signingInput = `${header}.${claims}`;
	const signature = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
	return `${signingInput}.${base64url(signature)}`;
}

export async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	// Refresh a minute early so a token cannot expire mid-request.
	if (cache && cache.expiresAt > now + 60) return cache.token;

	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: buildAssertion(sa, now),
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google token exchange failed (${response.status}): ${body}`);
	}

	const json = (await response.json()) as { access_token?: string; expires_in?: number };
	if (!json.access_token) throw new Error('Google token exchange returned no access_token');

	cache = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
	return cache.token;
}

/** Test seam. */
export function resetTokenCache(): void {
	cache = undefined;
}
