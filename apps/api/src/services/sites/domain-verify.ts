/**
 * Prove an owner controls the domain they added: the TXT record
 * `_restropulse.<hostname>` must contain `restropulse-verify=<token>`.
 *
 * The CNAME is checked too but only reported: apex domains can't CNAME, and
 * Cloudflare-style flattening hides it, so a missing CNAME never blocks.
 */

import { Resolver } from 'node:dns/promises';
import { domainVerifyRecordName, domainVerifyRecordValue } from '@restropulse/shared';

export interface DomainCheckResult {
    verified: boolean;
    cnameOk: boolean;
    /** Owner-facing reason when not verified. */
    reason?: string;
}

export interface DnsLookups {
    resolveTxt(name: string): Promise<string[][]>;
    resolveCname(name: string): Promise<string[]>;
}

function defaultResolver(): DnsLookups {
    // Short timeouts: the owner is waiting on a button press.
    const r = new Resolver({ timeout: 3000, tries: 2 });
    return { resolveTxt: (n) => r.resolveTxt(n), resolveCname: (n) => r.resolveCname(n) };
}

const notFoundCodes = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ESERVFAIL']);

export async function checkDomainOwnership(
    hostname: string,
    token: string,
    cnameTarget: string | null,
    dns: DnsLookups = defaultResolver(),
): Promise<DomainCheckResult> {
    const recordName = domainVerifyRecordName(hostname);
    const expected = domainVerifyRecordValue(token);

    let txt: string[][] = [];
    try {
        txt = await dns.resolveTxt(recordName);
    } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        if (!notFoundCodes.has(code)) {
            return { verified: false, cnameOk: false, reason: 'We could not reach DNS just now. Try again in a minute.' };
        }
    }

    let cnameOk = false;
    if (cnameTarget) {
        try {
            const cnames = await dns.resolveCname(hostname);
            cnameOk = cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === cnameTarget);
        } catch {
            cnameOk = false;
        }
    }

    // TXT strings can be split into 255-byte chunks; join each record's parts.
    const verified = txt.some((parts) => parts.join('').trim() === expected);
    if (verified) return { verified, cnameOk };
    return {
        verified: false,
        cnameOk,
        reason: txt.length
            ? `The TXT record at ${recordName} doesn't match yet. DNS changes can take up to an hour.`
            : `No TXT record found at ${recordName} yet. DNS changes can take up to an hour.`,
    };
}
