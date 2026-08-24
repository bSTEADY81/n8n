import { z } from 'zod';

import { indexToColumn, parseA1, quoteTab } from './a1.js';
import { FIXED_SHEETS, type Env } from './config.js';
import {
	assertBoundedWriteRange,
	assertNotProtected,
	assertWithin,
	assertWritable,
	GuardError,
	LIMITS,
	resolveSheet,
} from './guards.js';
import type { CellValue, SheetsClient, ValueInputOption } from './sheetsClient.js';

const spreadsheetId = z
	.string()
	.min(10)
	.describe('Google Sheets file ID, the long token from the spreadsheet URL.');

const columnLetter = z
	.string()
	.regex(/^[A-Za-z]{1,3}$/, 'Use a column letter such as A, F or AE.')
	.describe('Single column letter, e.g. "F".');

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Pulls the first row number out of an API-returned range like "Quotes!B47:L47". */
export function rowFromRange(range: string): number | null {
	const parsed = (() => {
		try {
			return parseA1(range);
		} catch {
			return null;
		}
	})();
	return parsed?.startRow ?? null;
}

function isBlank(value: CellValue | undefined): boolean {
	return value === undefined || value === null || String(value).trim() === '';
}

/** Blank is blank however it is spelled, and everything else compares trimmed. */
function sameCell(wanted: CellValue | undefined, actual: CellValue | undefined): boolean {
	if (isBlank(wanted) && isBlank(actual)) return true;
	return String(wanted ?? '').trim() === String(actual ?? '').trim();
}

function describe(value: CellValue | undefined): string {
	return isBlank(value) ? 'blank' : `"${String(value).trim()}"`;
}

function ok(payload: unknown) {
	return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown) {
	const message = error instanceof GuardError ? error.message : (error as Error).message;
	return {
		isError: true,
		content: [{ type: 'text' as const, text: message }],
	};
}

/** Wraps a handler so guard and API failures come back as tool errors, not transport errors. */
function guarded<T>(handler: (args: T) => Promise<ReturnType<typeof ok>>) {
	return async (args: T) => {
		try {
			return await handler(args);
		} catch (error) {
			return fail(error);
		}
	};
}

export interface ToolDeps {
	env: Env;
	client: SheetsClient;
}

export function buildTools({ env, client }: ToolDeps) {
	return [
		{
			name: 'sheets_registry',
			config: {
				title: 'List reachable spreadsheets',
				description:
					"List the KC's spreadsheets this server can reach, with their IDs and whether " +
					'they are read only. Call this first if you do not already know the sheet ID. ' +
					'Per-job quote workbooks are not listed here — resolve those with ' +
					'sheets_find_quote_workbook.',
				inputSchema: {},
				annotations: { readOnlyHint: true },
			},
			handler: guarded(async () =>
				ok({
					sheets: FIXED_SHEETS.map((sheet) => ({
						name: sheet.name,
						id: sheet.id,
						access: sheet.access,
						// Advertising write on a sheet whose columns are partly locked would
						// mislead a caller into planning a write that the guard rails reject.
						...(sheet.protectedColumns?.length
							? {
									protectedColumns: sheet.protectedColumns,
									protectedTabs: sheet.protectedTabs ?? 'all tabs',
								}
							: {}),
					})),
					quoteWorkbooks:
						'Not allowlisted individually. Use sheets_find_quote_workbook with a quote ' +
						'number or client surname to resolve one in Quotes 2026 S&I.',
					writeTools: ['sheets_write_cells', 'sheets_append_row'],
				}),
			),
		},

		{
			name: 'sheets_find_quote_workbook',
			config: {
				title: 'Find a quote workbook',
				description:
					"Find per-job quote workbooks in the Quotes 2026 S&I folder by quote number or " +
					"client name, e.g. 'Q7418'. Returns spreadsheet IDs usable with the other tools. " +
					'Most recently modified first.',
				inputSchema: {
					nameContains: z
						.string()
						.min(2)
						.describe("e.g. 'Q7418' or a client surname"),
				},
				annotations: { readOnlyHint: true },
			},
			handler: guarded(async ({ nameContains }: { nameContains: string }) => {
				const matches = await client.findQuoteWorkbooks(nameContains);
				return ok({
					query: nameContains,
					matchCount: matches.length,
					workbooks: matches,
					...(matches.length === 0
						? { note: 'No workbook in Quotes 2026 S&I matches that name.' }
						: {}),
				});
			}),
		},

		{
			name: 'sheets_list_tabs',
			config: {
				title: 'List spreadsheet tabs',
				description:
					'List every tab in an allowlisted spreadsheet, with its row and column counts. ' +
					'Use this to discover tabs whose names vary by job, such as the "PO *" tabs in a ' +
					'quote workbook or the supplier tabs used to detect Apollo vs Ausdeck.',
				inputSchema: { spreadsheetId },
				annotations: { readOnlyHint: true },
			},
			handler: guarded(async ({ spreadsheetId: id }: { spreadsheetId: string }) => {
				const rule = await resolveSheet(id, env, client);
				const { title, tabs } = await client.listTabs(id);
				return ok({ spreadsheetId: id, spreadsheetTitle: title, access: rule.access, tabs });
			}),
		},

		{
			name: 'sheets_read_range',
			config: {
				title: 'Read A1 ranges',
				description:
					'Read one or more A1 ranges in a single call. render="VALUE" returns what the cell ' +
					'displays; render="FORMULA" returns the underlying formula, which is what quote ' +
					'self-training and the Apollo/Ausdeck conversions need. Ranges may be open ended ' +
					'(e.g. "Quotes!A1:L") — only writes must be bounded.',
				inputSchema: {
					spreadsheetId,
					ranges: z
						.array(z.string().min(1))
						.min(1)
						.max(LIMITS.maxReadRanges)
						.describe('A1 ranges, e.g. ["Quotes!A1:L50", "Lead Tracker!A1:F20"].'),
					render: z
						.enum(['VALUE', 'FORMULA'])
						.default('VALUE')
						.describe('VALUE for displayed values, FORMULA for underlying formulas.'),
				},
				annotations: { readOnlyHint: true },
			},
			handler: guarded(
				async ({
					spreadsheetId: id,
					ranges,
					render,
				}: {
					spreadsheetId: string;
					ranges: string[];
					render?: 'VALUE' | 'FORMULA';
				}) => {
					await resolveSheet(id, env, client);
					assertWithin(ranges.length, LIMITS.maxReadRanges, 'ranges');
					const results = await client.batchGet(
						id,
						ranges,
						render === 'FORMULA' ? 'FORMULA' : 'FORMATTED_VALUE',
					);
					return ok({ spreadsheetId: id, render: render ?? 'VALUE', ranges: results });
				},
			),
		},

		{
			name: 'sheets_find_row',
			config: {
				title: 'Find a row by column value',
				description:
					'Scan one column server side and return the row number where it matches. Use this ' +
					'instead of pulling 50 rows into context and eyeballing them — duplicate email ' +
					'checks on the Ledger, quote-number lookups in the Closer Tracker, and so on. ' +
					'direction="top" returns the first match, "bottom" the last.',
				inputSchema: {
					spreadsheetId,
					tab: z.string().min(1).describe('Tab name, e.g. "Quotes".'),
					column: columnLetter,
					value: z.string().describe('Value to match.'),
					direction: z.enum(['top', 'bottom']).default('top'),
					match: z
						.enum(['insensitive', 'exact', 'contains'])
						.default('insensitive')
						.describe(
							'insensitive: trimmed, case-insensitive equality (default, right for ' +
								'emails and quote numbers). exact: trimmed, case sensitive. contains: substring.',
						),
					matchMode: z
						.enum(['insensitive', 'exact', 'contains'])
						.optional()
						.describe('Alias for match, accepted because existing callers use this name.'),
					startRow: z.number().int().min(1).default(1).describe('First row to scan.'),
				},
				annotations: { readOnlyHint: true },
			},
			handler: guarded(
				async (args: {
					spreadsheetId: string;
					tab: string;
					column: string;
					value: string;
					direction?: 'top' | 'bottom';
					match?: 'insensitive' | 'exact' | 'contains';
					matchMode?: 'insensitive' | 'exact' | 'contains';
					startRow?: number;
				}) => {
					const { spreadsheetId: id, tab, value } = args;
					const startRow = args.startRow ?? 1;
					const col = args.column.toUpperCase();
					// matchMode is what the skills were written against; honour it so a
					// caller asking for exact matching does not silently get insensitive.
					const mode = args.matchMode ?? args.match ?? 'insensitive';

					await resolveSheet(id, env, client);

					const endRow = startRow + LIMITS.maxScanRows - 1;
					const range = `${quoteTab(tab)}!${col}${startRow}:${col}${endRow}`;
					const [result] = await client.batchGet(id, [range], 'FORMATTED_VALUE');
					const cells = result?.values ?? [];

					const needle = mode === 'exact' ? value.trim() : value.trim().toLowerCase();
					const matches: Array<{ row: number; value: string }> = [];

					for (let i = 0; i < cells.length; i += 1) {
						const raw = cells[i]?.[0];
						if (raw === undefined || raw === null) continue;
						const text = String(raw).trim();
						const hay = mode === 'exact' ? text : text.toLowerCase();
						const hit =
							mode === 'contains' ? needle !== '' && hay.includes(needle) : hay === needle;
						if (hit) matches.push({ row: startRow + i, value: text });
					}

					const chosen =
						(args.direction ?? 'top') === 'bottom'
							? matches[matches.length - 1]
							: matches[0];

					return ok({
						spreadsheetId: id,
						tab,
						column: col,
						found: chosen !== undefined,
						row: chosen?.row ?? null,
						matchedValue: chosen?.value ?? null,
						matchCount: matches.length,
						allMatchRows: matches.map((m) => m.row),
						scannedRows: { from: startRow, to: startRow + Math.max(cells.length, 1) - 1 },
						scanTruncated: cells.length >= LIMITS.maxScanRows,
					});
				},
			),
		},

		{
			name: 'sheets_next_blank_row',
			config: {
				title: 'Find the next blank row',
				description:
					'Scan a column from startRow down and return the first row whose cell is empty. ' +
					'This is the "where does the new Ledger entry go" call — one small request instead ' +
					'of paging through a 1,700 row ledger.',
				inputSchema: {
					spreadsheetId,
					tab: z.string().min(1),
					column: columnLetter.describe(
						'Column that reliably has a value on every used row, e.g. "B" on the Ledger.',
					),
					startRow: z.number().int().min(1).default(2).describe('First row to consider.'),
				},
				annotations: { readOnlyHint: true },
			},
			handler: guarded(
				async (args: {
					spreadsheetId: string;
					tab: string;
					column: string;
					startRow?: number;
				}) => {
					const { spreadsheetId: id, tab } = args;
					const startRow = args.startRow ?? 2;
					const col = args.column.toUpperCase();

					await resolveSheet(id, env, client);

					const endRow = startRow + LIMITS.maxScanRows - 1;
					const range = `${quoteTab(tab)}!${col}${startRow}:${col}${endRow}`;
					const [result] = await client.batchGet(id, [range], 'FORMATTED_VALUE');
					const cells = result?.values ?? [];

					// Sheets drops trailing empty rows, so a short array already means "blank from here".
					let blankRow: number | null = null;
					for (let i = 0; i < cells.length; i += 1) {
						if (isBlank(cells[i]?.[0])) {
							blankRow = startRow + i;
							break;
						}
					}
					if (blankRow === null) blankRow = startRow + cells.length;

					let lastFilledRow: number | null = null;
					for (let i = cells.length - 1; i >= 0; i -= 1) {
						if (!isBlank(cells[i]?.[0])) {
							lastFilledRow = startRow + i;
							break;
						}
					}

					const exhausted = blankRow > endRow;
					return ok({
						spreadsheetId: id,
						tab,
						column: col,
						row: exhausted ? null : blankRow,
						lastFilledRow,
						scannedRows: { from: startRow, to: endRow },
						scanTruncated: exhausted,
						...(exhausted
							? {
									note:
										`No blank cell found in ${col}${startRow}:${col}${endRow}. ` +
										'Re-run with a higher startRow.',
								}
							: {}),
					});
				},
			),
		},

		{
			name: 'sheets_write_cells',
			config: {
				title: 'Write specific cells',
				description:
					'Write several bounded A1 ranges in one call — the Quote Sheet header block, or ' +
					'a Ledger row from B to L. Every range must name a tab and pin both corners ' +
					'(e.g. "Quotes!B12:L12"); bare tab names and whole-column ranges are rejected, as ' +
					'are writes to protected columns. Returns the row number of each write so you can ' +
					're-read and verify placement.',
				inputSchema: {
					spreadsheetId,
					updates: z
						.array(
							z.object({
								range: z.string().min(1).describe('Bounded A1 range, e.g. "Quotes!B12:L12".'),
								values: z
									.array(z.array(cellValue))
									.min(1)
									.describe('Rows of cell values, outer array is rows.'),
								expect: z
									.array(z.array(cellValue))
									.optional()
									.describe(
										'Optional guard, same shape as values: what each cell should contain ' +
											'right now. The write is refused if any cell differs, so a row that ' +
											'has shifted since you located it cannot be overwritten. Use "" for ' +
											'a cell you expect to be blank. Strongly recommended on the Ledger.',
									),
							}),
						)
						.min(1)
						.max(LIMITS.maxWriteUpdates),
					valueInputOption: z
						.enum(['USER_ENTERED', 'RAW'])
						.default('USER_ENTERED')
						.describe(
							'USER_ENTERED parses dates and formulas as if typed. RAW stores strings verbatim.',
						),
				},
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
			},
			handler: guarded(
				async (args: {
					spreadsheetId: string;
					updates: Array<{ range: string; values: CellValue[][]; expect?: CellValue[][] }>;
					valueInputOption?: ValueInputOption;
				}) => {
					const { spreadsheetId: id, updates } = args;
					const rule = await resolveSheet(id, env, client);
					assertWritable(rule);
					assertWithin(updates.length, LIMITS.maxWriteUpdates, 'updates');

					let totalCells = 0;
					for (const update of updates) {
						const parsed = assertBoundedWriteRange(update.range);
						assertNotProtected(rule, parsed);

						const rangeRows = Math.abs((parsed.endRow ?? 0) - (parsed.startRow ?? 0)) + 1;
						const rangeCols = Math.abs((parsed.endCol ?? 0) - (parsed.startCol ?? 0)) + 1;
						const dataRows = update.values.length;
						const dataCols = Math.max(...update.values.map((r) => r.length));

						if (dataRows > rangeRows || dataCols > rangeCols) {
							throw new GuardError(
								`Range "${update.range}" is ${rangeRows}x${rangeCols} but the values are ` +
									`${dataRows}x${dataCols}. Widen the range or trim the values.`,
							);
						}
						totalCells += dataRows * dataCols;
					}
					assertWithin(totalCells, LIMITS.maxWriteCells, 'cells in one write');

					// Optimistic concurrency: confirm the cells still hold what the caller
					// last saw before overwriting them. Checked for every update before any
					// write happens, so a mismatch anywhere aborts the whole batch.
					const guarded = updates.filter((u) => u.expect !== undefined);
					if (guarded.length > 0) {
						const current = await client.batchGet(
							id,
							guarded.map((u) => u.range),
							'FORMATTED_VALUE',
						);
						guarded.forEach((update, i) => {
							const found = current[i]?.values ?? [];
							(update.expect ?? []).forEach((row, r) => {
								row.forEach((wanted, c) => {
									const actual = found[r]?.[c];
									if (!sameCell(wanted, actual)) {
										throw new GuardError(
											`Refusing the write: ${update.range} row ${r + 1} column ${c + 1} ` +
												`holds ${describe(actual)} but you expected ${describe(wanted)}. ` +
												'Re-read the row — it has probably shifted.',
										);
									}
								});
							});
						});
					}

					const result = await client.batchUpdate(
						id,
						updates,
						args.valueInputOption ?? 'USER_ENTERED',
					);

					return ok({
						spreadsheetId: id,
						spreadsheetName: rule.name,
						totalUpdatedCells: result.totalUpdatedCells,
						// Guard rail 6: hand back row numbers so the caller can verify placement.
						written: updates.map((update, i) => {
							const updatedRange = result.updatedRanges[i] ?? update.range;
							return {
								requestedRange: update.range,
								updatedRange,
								row: rowFromRange(updatedRange) ?? rowFromRange(update.range),
								rows: update.values.length,
							};
						}),
					});
				},
			),
		},

		{
			name: 'sheets_append_row',
			config: {
				title: 'Append a row',
				description:
					'Append one row to the bottom of a tab using INSERT_ROWS, so an existing row is ' +
					'never overwritten. Use for the gallery sheet and the Closer Tracker logs. ' +
					'Returns the row number the data landed on.',
				inputSchema: {
					spreadsheetId,
					tab: z.string().min(1),
					values: z
						.array(cellValue)
						.min(1)
						.max(LIMITS.maxAppendCells)
						.describe('One row of cell values, left to right from column A.'),
					valueInputOption: z.enum(['USER_ENTERED', 'RAW']).default('USER_ENTERED'),
				},
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
			},
			handler: guarded(
				async (args: {
					spreadsheetId: string;
					tab: string;
					values: CellValue[];
					valueInputOption?: ValueInputOption;
				}) => {
					const { spreadsheetId: id, tab, values } = args;
					const rule = await resolveSheet(id, env, client);
					assertWritable(rule);
					assertWithin(values.length, LIMITS.maxAppendCells, 'cells in one append');

					const result = await client.append(
						id,
						quoteTab(tab),
						[values],
						args.valueInputOption ?? 'USER_ENTERED',
					);

					return ok({
						spreadsheetId: id,
						spreadsheetName: rule.name,
						tab,
						row: rowFromRange(result.updatedRange),
						updatedRange: result.updatedRange,
						rowsAppended: result.updatedRows,
						lastColumn: indexToColumn(values.length),
					});
				},
			),
		},
	];
}
