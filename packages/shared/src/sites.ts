/**
 * Per-restaurant websites (Phase 2, M3)
 *
 * Every restaurant with a slug gets a site at `/r/<slug>` on the sites host (always
 * works; used for preview and QA) and, once the wildcard DNS is live,
 * `<slug>.<sites root domain>`. A restaurant can also bring its own domain: the
 * owner adds it, points a CNAME at the sites host and proves ownership with a TXT
 * record; only `active` domains route to the restaurant (docs/LAUNCH_ARCHITECTURE B2).
 */

/** Verification and routing state of a restaurant's own domain. */
export type RestaurantDomainStatus = 'pending_dns' | 'verifying' | 'active' | 'failed';

/**
 * TLS state at the edge. `manual` means the certificate is issued outside the
 * app (ASSUMPTION: until the Cloudflare for SaaS adapter lands, an engineer adds
 * the hostname at the edge after the owner verifies it).
 */
export type RestaurantDomainSslStatus = 'none' | 'manual' | 'pending' | 'active' | 'failed';

export interface RestaurantDomain {
  id: string;
  restaurantId: string;
  /** Lower-case hostname without scheme, port or trailing dot, e.g. www.bawarchi.in */
  hostname: string;
  status: RestaurantDomainStatus;
  /** Value the owner puts in the TXT record at `_restropulse.<hostname>`. */
  verifyToken: string;
  /** Where the owner's CNAME should point. */
  cnameTarget: string;
  sslStatus: RestaurantDomainSslStatus;
  /** Human-readable reason for the last failed check. */
  lastError?: string;
  lastCheckedAt?: string | Date;
  createdAt?: string | Date;
  verifiedAt?: string | Date;
}

/** ASSUMPTION: three own domains per restaurant (apex + www + one spare) is plenty. */
export const MAX_DOMAINS_PER_RESTAURANT = 3;

/** Prefix of the TXT record that proves a domain belongs to the restaurant. */
export const DOMAIN_VERIFY_PREFIX = '_restropulse';

/** Value written into the TXT record: `restropulse-verify=<token>`. */
export const DOMAIN_VERIFY_VALUE_PREFIX = 'restropulse-verify=';

export function domainVerifyRecordName(hostname: string): string {
  return `${DOMAIN_VERIFY_PREFIX}.${hostname}`;
}

export function domainVerifyRecordValue(token: string): string {
  return `${DOMAIN_VERIFY_VALUE_PREFIX}${token}`;
}

/**
 * Normalise what an owner types ("https://WWW.Bawarchi.in/menu") to a bare
 * hostname ("www.bawarchi.in"). Returns null when nothing hostname-like is left.
 */
export function normalizeHostname(input: string): string | null {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/, 1)[0] ?? '';
  value = value.replace(/:\d+$/, '').replace(/\.$/, '');
  return value || null;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * True for a public hostname an owner could bring: at least two labels, a
 * letters-only TLD, no IP address, no localhost, no internal suffixes, and not
 * one of our own domains (those are served by slug, not by custom domain).
 */
export function isValidCustomHostname(hostname: string, reservedRoots: string[] = []): boolean {
  if (!hostname || hostname.length > 253) return false;
  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]{1,59}$/.test(tld)) return false;
  if (['localhost', 'local', 'internal', 'test', 'invalid', 'example'].includes(tld)) return false;
  for (const root of reservedRoots) {
    const r = root.toLowerCase();
    if (r && (hostname === r || hostname.endsWith(`.${r}`))) return false;
  }
  return true;
}

/**
 * Read the restaurant slug out of a `<slug>.<root>` host. Only one label deep:
 * `a.b.root` and the bare root return null.
 */
export function slugFromSitesHost(host: string, rootDomain: string): string | null {
  const h = normalizeHostname(host);
  const root = normalizeHostname(rootDomain);
  if (!h || !root || !h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, -(root.length + 1));
  if (!sub || sub.includes('.') || sub === 'www') return null;
  return sub;
}
