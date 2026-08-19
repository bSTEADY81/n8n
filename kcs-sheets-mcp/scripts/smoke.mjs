#!/usr/bin/env node
/**
 * Step 1 of the build order: prove the Google side works before trusting any MCP code.
 *
 * Deliberately standalone — it imports nothing from src/, so a pass here means the
 * service account, the API enablement and the sharing are right, independently of
 * the server. Read-only; it never writes to a sheet.
 *
 *   node --env-file=.env scripts/smoke.mjs
 */
import { createSign } from 'node:crypto';

const SCOPES = [
	'https://www.googleapis.com/auth/spreadsheets',
	'https://www.googleapis.com/auth/drive.metadata.readonly',
].join(' ');

const FIXED = [
	['KCs Ledger 2026', '1sLw8776rK6WEd01gW0Weq-R6bdeAdduaVul8IpojUjQ', 'readwrite'],
	['Project Schedule', '14kpETbDJYtbRzIrxAlMMaxW1-cqKJMmPpifcJfwVpU0', 'read'],
	['The Closer Tracker', '1D8Z6MNnICnR_KfHc3dXsIRjbx610158li_8SvTED7g0', 'readwrite'],
	['Kevy Training Log', '1O-ZjfNTdIjiWO7CSeaGyCG7rmkN5_oD0WNhDvuRjoh8', 'readwrite'],
	['Past Projects Update', '1LpwYBNFViprmanTLfktP6VMykFyu0-0CPqVtW9Sgb60', 'readwrite'],
];

function base64url(input) {
	return Buffer.from(input).toString('base64url');
}

function serviceAccount() {
	const blob = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (blob && blob.trim() !== '') {
		const text = blob.trim().startsWith('{') ? blob : Buffer.from(blob, 'base64').toString('utf8');
		const parsed = JSON.parse(text);
		return { email: parsed.client_email, key: parsed.private_key };
	}
	const key = process.env.GOOGLE_PRIVATE_KEY ?? '';
	return {
		email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
		key: key.includes('\\n') ? key.replaceAll('\\n', '\n') : key,
	};
}

async function accessToken({ email, key }) {
	const now = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({
			iss: email,
			scope: SCOPES,
			aud: 'https://oauth2.googleapis.com/token',
			iat: now,
			exp: now + 3600,
		}),
	);
	const signature = base64url(
		createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key),
	);

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${header}.${claims}.${signature}`,
		}),
	});
	const json = await response.json();
	if (!response.ok) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
	return json.access_token;
}

async function get(url, token) {
	const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const reason = body?.error?.message ?? `HTTP ${response.status}`;
		throw new Error(reason);
	}
	return body;
}

let failures = 0;

function report(label, ok, detail) {
	if (!ok) failures += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const sa = serviceAccount();
if (!sa.email || !sa.key) {
	console.error(
		'Set GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.',
	);
	process.exit(2);
}

console.log(`Service account: ${sa.email}\n`);

const token = await accessToken(sa);
report('token exchange', true);

for (const [name, id, wanted] of FIXED) {
	try {
		const meta = await get(
			`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`,
			token,
		);
		const caps = await get(
			`https://www.googleapis.com/drive/v3/files/${id}?fields=capabilities(canEdit)&supportsAllDrives=true`,
			token,
		);
		const canEdit = caps.capabilities?.canEdit === true;
		const tabs = (meta.sheets ?? []).length;

		if (wanted === 'readwrite' && !canEdit) {
			report(name, false, 'readable but not writable — share it as Editor');
		} else if (wanted === 'read' && canEdit) {
			report(name, true, `${tabs} tabs, shared as Editor (Viewer would be tighter)`);
		} else {
			report(name, true, `${tabs} tabs, ${canEdit ? 'editor' : 'viewer'}`);
		}
	} catch (error) {
		report(name, false, error.message);
	}
}

const folderId = process.env.QUOTES_FOLDER_ID;
if (!folderId) {
	report('Quotes 2026 S&I folder', false, 'QUOTES_FOLDER_ID is not set');
} else {
	try {
		const folder = await get(
			`https://www.googleapis.com/drive/v3/files/${folderId}?fields=name,mimeType&supportsAllDrives=true`,
			token,
		);
		report('Quotes 2026 S&I folder', true, folder.name);

		const query = encodeURIComponent(
			`'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
		);
		const children = await get(
			`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=3&fields=files(id,name,capabilities(canEdit))&supportsAllDrives=true&includeItemsFromAllDrives=true`,
			token,
		);
		const files = children.files ?? [];
		if (files.length === 0) {
			report('quote workbooks visible', false, 'folder is shared but no workbooks are visible');
		} else {
			const editable = files.filter((f) => f.capabilities?.canEdit).length;
			report(
				'quote workbooks visible',
				editable === files.length,
				`${files.length} sampled, ${editable} editable (e.g. ${files[0].name})`,
			);
		}
	} catch (error) {
		report('Quotes 2026 S&I folder', false, error.message);
	}
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
