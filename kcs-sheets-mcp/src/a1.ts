/**
 * A1 notation parsing. Deliberately strict: the guard rails in guards.ts depend on
 * being able to tell a bounded range ("Quotes!B12:L12") from an open-ended one
 * ("Quotes", "Quotes!B:L", "Quotes!12:12"), and a permissive parser would let
 * open-ended writes through.
 */

export interface ParsedA1 {
	/** Tab name, unquoted. Undefined when the range carried no "Tab!" prefix. */
	tab?: string;
	/** 1-based column index. Undefined for row-only ranges like "12:14". */
	startCol?: number;
	/** 1-based row index. Undefined for column-only ranges like "B:L". */
	startRow?: number;
	endCol?: number;
	endRow?: number;
	/** True when the range names a tab and nothing else. */
	wholeTab: boolean;
}

export class A1Error extends Error {}

/** Sheets columns top out at three letters (ZZZ), so anything longer is a tab name. */
const CELL = /^([A-Za-z]{1,3})?(\d+)?$/;

/**
 * Decides whether an un-prefixed string like "B12:L12" is a cell range or a tab
 * name like "Job Schedule". Mirrors how Sheets itself reads a bare reference.
 */
function looksLikeCellRange(cells: string): boolean {
	const parts = cells.split(':');
	if (parts.length > 2) return false;
	return parts.every((part) => part !== '' && CELL.test(part));
}

/** "A" -> 1, "Z" -> 26, "AA" -> 27. */
export function columnToIndex(letters: string): number {
	let n = 0;
	for (const ch of letters.toUpperCase()) {
		n = n * 26 + (ch.charCodeAt(0) - 64);
	}
	return n;
}

/** 1 -> "A", 27 -> "AA". */
export function indexToColumn(index: number): string {
	if (index < 1) throw new A1Error(`Column index must be >= 1, got ${index}`);
	let n = index;
	let out = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

/** Wraps a tab name for use in A1 notation, quoting when the name needs it. */
export function quoteTab(tab: string): string {
	if (/^[A-Za-z0-9_]+$/.test(tab) && !/^\d/.test(tab)) return tab;
	return `'${tab.replace(/'/g, "''")}'`;
}

/** Splits "'My Tab'!A1:C5" into its tab and cell halves, honouring quoting. */
function splitTab(range: string): { tab?: string; cells: string } {
	if (range.startsWith("'")) {
		// Scan for the closing quote, treating '' as an escaped quote.
		let i = 1;
		let tab = '';
		while (i < range.length) {
			if (range[i] === "'") {
				if (range[i + 1] === "'") {
					tab += "'";
					i += 2;
					continue;
				}
				break;
			}
			tab += range[i];
			i += 1;
		}
		if (i >= range.length) throw new A1Error(`Unterminated quoted tab name in "${range}"`);
		const rest = range.slice(i + 1);
		if (rest === '') return { tab, cells: '' };
		if (!rest.startsWith('!')) throw new A1Error(`Expected "!" after tab name in "${range}"`);
		return { tab, cells: rest.slice(1) };
	}
	const bang = range.lastIndexOf('!');
	if (bang === -1) return { cells: range };
	return { tab: range.slice(0, bang), cells: range.slice(bang + 1) };
}

export function parseA1(range: string): ParsedA1 {
	const trimmed = range.trim();
	if (trimmed === '') throw new A1Error('Range is empty');

	const { tab, cells } = splitTab(trimmed);

	if (cells === '') {
		// Either "Tab" or "'Tab'" — a whole-tab reference with no cell part.
		if (tab === undefined) throw new A1Error(`Could not parse range "${range}"`);
		return { tab, wholeTab: true };
	}

	// With no "Tab!" prefix the string is ambiguous: "B12:L12" is a range,
	// "Job Schedule" is a tab. Anything that does not read as cells is a tab name.
	if (tab === undefined && !looksLikeCellRange(cells)) {
		return { tab: cells, wholeTab: true };
	}

	const parts = cells.split(':');
	if (parts.length > 2) throw new A1Error(`Malformed range "${range}"`);
	const startRaw = parts[0] ?? '';
	const endRaw = parts[1];

	const start = CELL.exec(startRaw);
	if (!start || (start[1] === undefined && start[2] === undefined)) {
		throw new A1Error(`Malformed range "${range}"`);
	}

	const parsed: ParsedA1 = {
		tab,
		wholeTab: false,
		startCol: start[1] ? columnToIndex(start[1]) : undefined,
		startRow: start[2] ? Number(start[2]) : undefined,
	};

	if (endRaw === undefined) {
		// Single cell: "B12" is the range B12:B12.
		parsed.endCol = parsed.startCol;
		parsed.endRow = parsed.startRow;
		return parsed;
	}

	const end = CELL.exec(endRaw);
	if (!end || (end[1] === undefined && end[2] === undefined)) {
		throw new A1Error(`Malformed range "${range}"`);
	}
	parsed.endCol = end[1] ? columnToIndex(end[1]) : undefined;
	parsed.endRow = end[2] ? Number(end[2]) : undefined;
	return parsed;
}

/** True when the range pins both corners to a specific column AND row. */
export function isBounded(parsed: ParsedA1): boolean {
	return (
		!parsed.wholeTab &&
		parsed.startCol !== undefined &&
		parsed.startRow !== undefined &&
		parsed.endCol !== undefined &&
		parsed.endRow !== undefined
	);
}

/** Every column index the range touches, inclusive. Requires a bounded range. */
export function columnsIn(parsed: ParsedA1): number[] {
	if (parsed.startCol === undefined || parsed.endCol === undefined) return [];
	const lo = Math.min(parsed.startCol, parsed.endCol);
	const hi = Math.max(parsed.startCol, parsed.endCol);
	const out: number[] = [];
	for (let c = lo; c <= hi; c += 1) out.push(c);
	return out;
}
