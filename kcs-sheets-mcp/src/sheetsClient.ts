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
		const token = await getAccessToken(this.env.serviceAccount);
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

	/** Drive parents, used by the folder-scoped allowlist rule. */
	async getParents(spreadsheetId: string): Promise<string[]> {
		const url = `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=parents&supportsAllDrives=true`;
		const json = await this.request<{ parents?: string[] }>(url);
		return json.parents ?? [];
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
