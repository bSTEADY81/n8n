import type { Env } from './config.js';
import { getAccessToken } from './googleAuth.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
export type ValueInputOption = 'RAW' | 'USER_ENTERED';
export type CellValue = string | number | boolean | null;

export interface TabInfo {
	sheetId: number;
	title: string;
	index: number;
	rowCount: number;
	columnCount: number;
	hidden: boolean;
}

export interface ValueRange {
	range: string;
	values: CellValue[][];
}

export interface AppendResult {
	updatedRange: string;
	updatedRows: number;
}

export interface UpdateResult {
	totalUpdatedCells: number;
	updatedRanges: string[];
}

export class GoogleApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export class SheetsClient {
	constructor(private readonly env: Env) {}

	private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
		const token = await getAccessToken(this.env.credentials);
		const response = await fetch(url, {
			...init,
			headers: {
				...(init.headers ?? {}),
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new GoogleApiError(
				`Google API ${response.status} for ${new URL(url).pathname}: ${body.slice(0, 500)}`,
				response.status,
			);
		}
		return (await response.json()) as T;
	}

	/** Resolved once per instance when QUOTES_FOLDER_ID is not configured. */
	private resolvedFolderId?: string;

	/**
	 * The quotes folder ID, by configuration if given, otherwise looked up by name.
	 * The name fallback exists so replacing a server that had no QUOTES_FOLDER_ID
	 * does not require adding one.
	 */
	async quotesFolderId(): Promise<string> {
		if (this.env.quotesFolderId) return this.env.quotesFolderId;
		if (this.resolvedFolderId) return this.resolvedFolderId;

		const name = this.env.quotesFolderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
		const params = new URLSearchParams({
			q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`,
			fields: 'files(id,name)',
			pageSize: '2',
			supportsAllDrives: 'true',
			includeItemsFromAllDrives: 'true',
		});
		const json = await this.request<{ files?: Array<{ id?: string }> }>(`${DRIVE_API}?${params}`);
		const files = json.files ?? [];
		if (files.length === 0) {
			throw new GoogleApiError(
				`No Drive folder named "${this.env.quotesFolderName}". Set QUOTES_FOLDER_ID.`,
				404,
			);
		}
		if (files.length > 1) {
			throw new GoogleApiError(
				`More than one Drive folder named "${this.env.quotesFolderName}". Set QUOTES_FOLDER_ID.`,
				409,
			);
		}
		this.resolvedFolderId = files[0]?.id ?? '';
		return this.resolvedFolderId;
	}

	/** Drive parents, used by the folder-scoped allowlist rule. */
	async getParents(spreadsheetId: string): Promise<string[]> {
		const url = `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=parents&supportsAllDrives=true`;
		const json = await this.request<{ parents?: string[] }>(url);
		return json.parents ?? [];
	}

	/**
	 * Per-job quote workbooks live in the Quotes 2026 S&I folder and cannot be
	 * allowlisted by ID, so callers resolve them by name first. Scoped to the
	 * folder, which is the same boundary resolveSheet enforces on access.
	 */
	async findQuoteWorkbooks(
		nameContains: string,
	): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
		const folderId = await this.quotesFolderId();
		// Drive query strings are single-quoted, so a quote in the search term
		// would otherwise terminate the literal early.
		const safe = nameContains.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
		const q =
			`'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' ` +
			`and name contains '${safe}' and trashed=false`;
		const params = new URLSearchParams({
			q,
			fields: 'files(id,name,modifiedTime)',
			orderBy: 'modifiedTime desc',
			pageSize: '20',
			supportsAllDrives: 'true',
			includeItemsFromAllDrives: 'true',
		});
		const json = await this.request<{
			files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
		}>(`${DRIVE_API}?${params}`);
		return (json.files ?? []).map((f) => ({
			id: f.id ?? '',
			name: f.name ?? '',
			modifiedTime: f.modifiedTime ?? '',
		}));
	}

	async listTabs(spreadsheetId: string): Promise<{ title: string; tabs: TabInfo[] }> {
		const url =
			`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}` +
			'?fields=properties.title,sheets.properties';
		const json = await this.request<{
			properties?: { title?: string };
			sheets?: Array<{
				properties?: {
					sheetId?: number;
					title?: string;
					index?: number;
					hidden?: boolean;
					gridProperties?: { rowCount?: number; columnCount?: number };
				};
			}>;
		}>(url);

		const tabs = (json.sheets ?? []).map((sheet) => {
			const p = sheet.properties ?? {};
			return {
				sheetId: p.sheetId ?? 0,
				title: p.title ?? '',
				index: p.index ?? 0,
				rowCount: p.gridProperties?.rowCount ?? 0,
				columnCount: p.gridProperties?.columnCount ?? 0,
				hidden: p.hidden === true,
			};
		});
		return { title: json.properties?.title ?? '', tabs };
	}

	async batchGet(
		spreadsheetId: string,
		ranges: string[],
		valueRenderOption: ValueRenderOption,
	): Promise<ValueRange[]> {
		const params = new URLSearchParams({ valueRenderOption, majorDimension: 'ROWS' });
		for (const range of ranges) params.append('ranges', range);

		const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`;
		const json = await this.request<{
			valueRanges?: Array<{ range?: string; values?: CellValue[][] }>;
		}>(url);

		return (json.valueRanges ?? []).map((vr, i) => ({
			range: vr.range ?? ranges[i] ?? '',
			values: vr.values ?? [],
		}));
	}

	async batchUpdate(
		spreadsheetId: string,
		data: Array<{ range: string; values: CellValue[][] }>,
		valueInputOption: ValueInputOption,
	): Promise<UpdateResult> {
		const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
		const json = await this.request<{
			totalUpdatedCells?: number;
			responses?: Array<{ updatedRange?: string }>;
		}>(url, {
			method: 'POST',
			body: JSON.stringify({
				valueInputOption,
				data: data.map((d) => ({ range: d.range, majorDimension: 'ROWS', values: d.values })),
			}),
		});

		return {
			totalUpdatedCells: json.totalUpdatedCells ?? 0,
			updatedRanges: (json.responses ?? []).map((r) => r.updatedRange ?? ''),
		};
	}

	async append(
		spreadsheetId: string,
		range: string,
		values: CellValue[][],
		valueInputOption: ValueInputOption,
	): Promise<AppendResult> {
		const params = new URLSearchParams({
			valueInputOption,
			// Guard rail 5: never let Sheets overwrite an existing trailing row.
			insertDataOption: 'INSERT_ROWS',
			includeValuesInResponse: 'false',
		});
		const url =
			`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}` +
			`/values/${encodeURIComponent(range)}:append?${params}`;

		const json = await this.request<{
			updates?: { updatedRange?: string; updatedRows?: number };
		}>(url, { method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values }) });

		return {
			updatedRange: json.updates?.updatedRange ?? '',
			updatedRows: json.updates?.updatedRows ?? 0,
		};
	}
}
