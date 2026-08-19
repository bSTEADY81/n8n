import { describe, expect, it } from 'vitest';

import { isAuthorised, tokenMatches } from '../src/auth.js';

const SECRET = 'a'.repeat(64);

describe('tokenMatches', () => {
	it('accepts the exact token and nothing else', () => {
		expect(tokenMatches(SECRET, SECRET)).toBe(true);
		expect(tokenMatches('b'.repeat(64), SECRET)).toBe(false);
		expect(tokenMatches(SECRET.slice(0, 63), SECRET)).toBe(false);
		expect(tokenMatches(`${SECRET}x`, SECRET)).toBe(false);
		expect(tokenMatches(undefined, SECRET)).toBe(false);
		expect(tokenMatches('', SECRET)).toBe(false);
	});
});

describe('isAuthorised', () => {
	it('accepts the token from the URL path', () => {
		expect(isAuthorised({ queryToken: SECRET }, SECRET)).toBe(true);
	});

	it('accepts a bearer header, case insensitively on the scheme', () => {
		expect(isAuthorised({ authorizationHeader: `Bearer ${SECRET}` }, SECRET)).toBe(true);
		expect(isAuthorised({ authorizationHeader: `bearer ${SECRET}` }, SECRET)).toBe(true);
	});

	it('accepts the fallback custom header', () => {
		expect(isAuthorised({ customHeader: SECRET }, SECRET)).toBe(true);
	});

	it('rejects when nothing is supplied or everything is wrong', () => {
		expect(isAuthorised({}, SECRET)).toBe(false);
		expect(
			isAuthorised(
				{ queryToken: 'nope', authorizationHeader: 'Bearer nope', customHeader: 'nope' },
				SECRET,
			),
		).toBe(false);
	});
});
