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
	/**
	 * Candidate secrets from the query string. More than one name is accepted
	 * because the connector predating this server passes it as "k", and changing
	 * the connector URL is more disruptive than reading a second parameter.
	 */
	queryTokens?: Array<string | string[] | undefined>;
	authorizationHeader?: string;
	customHeader?: string | string[];
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Accepted routes, per section 5 of the spec: the secret in the URL (as a path
 * segment rewritten to ?token=, or directly as ?token= / ?k=), and a bearer or
 * X-MCP-Token header for when the connector dialog exposes request headers.
 *
 * Every candidate is compared even after a match so the work does not vary with
 * which route carried the secret.
 */
export function isAuthorised(inputs: AuthInputs, expected: string): boolean {
	const bearer = inputs.authorizationHeader?.replace(/^Bearer\s+/i, '');
	const candidates = [
		...(inputs.queryTokens ?? []).map(first),
		bearer,
		first(inputs.customHeader),
	];
	return candidates.reduce<boolean>(
		(matched, candidate) => tokenMatches(candidate, expected) || matched,
		false,
	);
}
