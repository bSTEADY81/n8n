import { timingSafeEqual } from 'node:crypto';

/** Constant-time comparison that tolerates differing lengths. */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
	if (provided === undefined || provided === '') return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) {
		// Still burn a comparison so length is not leaked by timing.
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}

export interface AuthInputs {
	/** Token lifted out of the URL path by the vercel.json rewrite. */
	queryToken?: string | string[];
	authorizationHeader?: string;
	customHeader?: string | string[];
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Two accepted routes, per section 5 of the spec: the secret embedded in the URL
 * path, which works with a plain connector-by-URL add today, and a bearer token
 * for when the connector dialog exposes request headers.
 */
export function isAuthorised(inputs: AuthInputs, expected: string): boolean {
	const bearer = inputs.authorizationHeader?.replace(/^Bearer\s+/i, '');
	return (
		tokenMatches(first(inputs.queryToken), expected) ||
		tokenMatches(bearer, expected) ||
		tokenMatches(first(inputs.customHeader), expected)
	);
}
