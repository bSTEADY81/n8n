import { describe, expect, it } from 'vitest';

import { columnToIndex, indexToColumn, isBounded, parseA1, quoteTab } from '../src/a1.js';

describe('column conversion', () => {
	it('round trips', () => {
		for (const [letter, index] of [
			['A', 1],
			['Z', 26],
			['AA', 27],
			['AE', 31],
			['BZ', 78],
		] as const) {
			expect(columnToIndex(letter)).toBe(index);
			expect(indexToColumn(index)).toBe(letter);
		}
	});
});

describe('quoteTab', () => {
	it('leaves simple names alone', () => {
		expect(quoteTab('Quotes')).toBe('Quotes');
	});

	it('quotes names with spaces and escapes inner quotes', () => {
		expect(quoteTab('Job Schedule')).toBe("'Job Schedule'");
		expect(quoteTab("Brad's Log")).toBe("'Brad''s Log'");
		expect(quoteTab('PO 1')).toBe("'PO 1'");
	});
});

describe('parseA1', () => {
	it('parses a bounded range with a tab', () => {
		const parsed = parseA1('Quotes!B12:L12');
		expect(parsed).toMatchObject({
			tab: 'Quotes',
			startCol: 2,
			startRow: 12,
			endCol: 12,
			endRow: 12,
			wholeTab: false,
		});
		expect(isBounded(parsed)).toBe(true);
	});

	it('treats a single cell as a one-cell range', () => {
		const parsed = parseA1('Quotes!AE7');
		expect(parsed.startCol).toBe(31);
		expect(parsed.endCol).toBe(31);
		expect(parsed.startRow).toBe(7);
		expect(parsed.endRow).toBe(7);
		expect(isBounded(parsed)).toBe(true);
	});

	it('unquotes a quoted tab name', () => {
		expect(parseA1("'Job Schedule'!A1:C5").tab).toBe('Job Schedule');
		expect(parseA1("'Brad''s Log'!A1").tab).toBe("Brad's Log");
	});

	it('handles a tab name containing an exclamation mark', () => {
		expect(parseA1("'Wow! Tab'!A1:B2").tab).toBe('Wow! Tab');
	});

	it('flags a bare tab name as whole-tab', () => {
		expect(parseA1('Quotes')).toMatchObject({ tab: 'Quotes', wholeTab: true });
		expect(parseA1('Job Schedule')).toMatchObject({ tab: 'Job Schedule', wholeTab: true });
		expect(parseA1("'Active Pipeline'")).toMatchObject({
			tab: 'Active Pipeline',
			wholeTab: true,
		});
	});

	it('marks column-only and row-only ranges as unbounded', () => {
		expect(isBounded(parseA1('Quotes!B:L'))).toBe(false);
		expect(isBounded(parseA1('Quotes!12:14'))).toBe(false);
		expect(isBounded(parseA1('Quotes!A1:L'))).toBe(false);
	});

	it('parses a range with no tab prefix', () => {
		expect(parseA1('B12:L12').tab).toBeUndefined();
	});

	it('rejects nonsense', () => {
		expect(() => parseA1('Quotes!A1:B2:C3')).toThrow();
		expect(() => parseA1('')).toThrow();
	});
});
