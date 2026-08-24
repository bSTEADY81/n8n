import { createSign } from 'node:crypto';

import type { GoogleCredentials, ServiceAccountKey } from './config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Only used by the service-account path. The OAuth refresh-token grant carries
 * whatever scopes were consented when the token was minted, and passing a scope
 * on refresh does not widen them.
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
			iss: sa.clientEmail,
			scope: SCOPES,
			aud: TOKEN_URL,
			iat: now,
			exp: now + 3600,
		}),
	);
	const signingInput = `${header}.${claims}`;
	const signature = createSign('RSA-SHA256').update(signingInput).sign(sa.privateKey);
	return `${signingInput}.${base64url(signature)}`;
}

/** The form body differs per credential kind; the exchange itself does not. */
function grantBody(credentials: GoogleCredentials, now: number): URLSearchParams {
	if (credentials.kind === 'service_account') {
		return new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: buildAssertion(credentials, now),
		});
	}
	return new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		refresh_token: credentials.refreshToken,
	});
}

export async function getAccessToken(credentials: GoogleCredentials): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	// Refresh a minute early so a token cannot expire mid-request.
	if (cache && cache.expiresAt > now + 60) return cache.token;

	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: grantBody(credentials, now),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Google token exchange failed for ${credentials.kind} (${response.status}): ${body}`,
		);
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
