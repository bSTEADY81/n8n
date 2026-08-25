/**
 * Guard rails from section 4 of the build spec. These encode rules the skills
 * currently rely on Claude to remember, so they are enforced here rather than
 * in prose.
 */

import { columnsIn, indexToColumn, isBounded, parseA1, type ParsedA1 } from './a1.js';
import { FIXED_SHEETS, type Env, type SheetRule } from './config.js';
import type { SheetsClient } from './sheetsClient.js';

export class GuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GuardError';
	}
}

/** Parentage rarely changes and a Drive call per tool call is wasteful. */
const parentCache = new Map<string, boolean>();

/** Test seam. */
export function resetParentCache(): void {
	parentCache.clear();
}

/**
 * Resolves the rules that apply to a spreadsheet.
 *
 * A sheet named in FIXED_SHEETS always gets its configured rules — Project
 * Schedule stays read-only, the Ledger keeps its protected columns — whatever
 * the allowlist setting is.
 *
 * Anything else depends on RESTRICT_TO_ALLOWLIST. Off (the default), any
 * spreadsheet the credentials can reach is readable and writable. On, an
 * unknown sheet is admitted only by EXTRA_SHEET_IDS or by living in the quotes
 * folder, and is otherwise refused.
 */
export async function resolveSheet(
	spreadsheetId: string,
	env: Env,
	client: SheetsClient,
): Promise<SheetRule> {
	const fixed = FIXED_SHEETS.find((s) => s.id === spreadsheetId);
	if (fixed) return fixed;

	if (env.extraSheetIds.includes(spreadsheetId)) {
		return { id: spreadsheetId, name: 'Allowlisted spreadsheet', access: 'readwrite' };
	}

	if (!env.restrictToAllowlist) {
		return {
			id: spreadsheetId,
			name: 'Unlisted spreadsheet',
			access: 'readwrite',
		};
	}

	const cached = parentCache.get(spreadsheetId);
	if (cached === true) return quoteWorkbookRule(spreadsheetId);
	if (cached === false) throw notAllowed(spreadsheetId);

	let parents: string[];
	try {
		parents = await client.getParents(spreadsheetId);
	} catch {
		// A Drive failure must not widen access. Treat it as "not admitted".
		throw notAllowed(spreadsheetId);
	}

	let folderId: string;
	try {
		folderId = await client.quotesFolderId();
	} catch {
		throw notAllowed(spreadsheetId);
	}

	const inFolder = parents.includes(folderId);
	parentCache.set(spreadsheetId, inFolder);
	if (!inFolder) throw notAllowed(spreadsheetId);
	return quoteWorkbookRule(spreadsheetId);
}

function quoteWorkbookRule(spreadsheetId: string): SheetRule {
	return { id: spreadsheetId, name: 'Quote workbook (Quotes 2026 S&I)', access: 'readwrite' };
}

function notAllowed(spreadsheetId: string): GuardError {
	return new GuardError(
		`Spreadsheet ${spreadsheetId} is not on the allowlist. Allowed: ` +
			`${FIXED_SHEETS.map((s) => s.name).join(', ')}, any workbook in Quotes 2026 S&I, ` +
			'or anything in EXTRA_SHEET_IDS. Unset RESTRICT_TO_ALLOWLIST to reach any spreadsheet.',
	);
}

/** Guard rail 4: read-only sheets. Project Schedule is read-only by configuration. */
export function assertWritable(rule: SheetRule): void {
	if (rule.access !== 'readwrite') {
		throw new GuardError(`${rule.name} is read-only. Writes to it are rejected by policy.`);
	}
}

/**
 * Guard rail 3: no open-ended writes. A write range must name a tab and pin both
 * corners to a specific column and row, so "Quotes", "Quotes!B:L" and "Quotes!12:14"
 * are all rejected.
 */
export function assertBoundedWriteRange(range: string): ParsedA1 {
	let parsed: ParsedA1;
	try {
		parsed = parseA1(range);
	} catch (error) {
		throw new GuardError(`Could not parse range "${range}": ${(error as Error).message}`);
	}

	if (parsed.tab === undefined) {
		throw new GuardError(
			`Write range "${range}" does not name a tab. Use "Tab!B12:L12", not "B12:L12".`,
		);
	}
	if (!isBounded(parsed)) {
		throw new GuardError(
			`Write range "${range}" is open ended. Give both corners a column and a row, ` +
				'e.g. "Quotes!B12:L12". Bare tab names and whole column or row ranges are rejected.',
		);
	}
	return parsed;
}

/**
 * Guard rail 2: protected columns. Applies to in-place writes only; appends create
 * a new row and cannot clobber a pre-filled quote number or a generated link.
 */
export function assertNotProtected(rule: SheetRule, parsed: ParsedA1): void {
	const protectedCols = rule.protectedColumns ?? [];
	if (protectedCols.length === 0) return;

	if (rule.protectedTabs && parsed.tab !== undefined) {
		const scoped = rule.protectedTabs.some(
			(t) => t.toLowerCase() === parsed.tab?.toLowerCase(),
		);
		if (!scoped) return;
	}

	const blocked = new Set(protectedCols.map((c) => c.toUpperCase()));
	const hit = columnsIn(parsed)
		.map(indexToColumn)
		.filter((letter) => blocked.has(letter));

	if (hit.length > 0) {
		throw new GuardError(
			`Column${hit.length > 1 ? 's' : ''} ${hit.join(', ')} on ${rule.name}` +
				`${parsed.tab ? ` tab "${parsed.tab}"` : ''} ${hit.length > 1 ? 'are' : 'is'} ` +
				'write protected. Rewrite the range to skip them.',
		);
	}
}

/** Sanity ceilings, so a malformed call cannot ask Google for a million cells. */
export const LIMITS = {
	maxReadRanges: 20,
	maxScanRows: 5000,
	maxWriteUpdates: 25,
	maxWriteCells: 5000,
	maxAppendCells: 200,
} as const;

export function assertWithin(value: number, limit: number, what: string): void {
	if (value > limit) {
		throw new GuardError(`Too many ${what}: ${value} requested, limit is ${limit}.`);
	}
}
