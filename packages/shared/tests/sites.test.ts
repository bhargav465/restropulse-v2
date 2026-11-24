import { describe, it, expect } from 'vitest';
import {
  normalizeHostname,
  isValidCustomHostname,
  slugFromSitesHost,
  domainVerifyRecordName,
  domainVerifyRecordValue,
} from '../src/index.js';

describe('normalizeHostname', () => {
  it('strips scheme, path, port, trailing dot and case', () => {
    expect(normalizeHostname('https://WWW.Bawarchi.in/menu?x=1')).toBe('www.bawarchi.in');
    expect(normalizeHostname('bawarchi.in:443')).toBe('bawarchi.in');
    expect(normalizeHostname('bawarchi.in.')).toBe('bawarchi.in');
    expect(normalizeHostname('  shop.example.com#top ')).toBe('shop.example.com');
  });

  it('returns null for empty input', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname('   ')).toBeNull();
    expect(normalizeHostname('https://')).toBeNull();
    expect(normalizeHostname(undefined as unknown as string)).toBeNull();
  });
});

describe('isValidCustomHostname', () => {
  it('accepts ordinary public hostnames', () => {
    expect(isValidCustomHostname('bawarchi.in')).toBe(true);
    expect(isValidCustomHostname('www.bawarchi.co.in')).toBe(true);
    expect(isValidCustomHostname('order.xn--h2brj9c')).toBe(true);
  });

  it('rejects malformed, internal and IP hosts', () => {
    expect(isValidCustomHostname('')).toBe(false);
    expect(isValidCustomHostname('localhost')).toBe(false);
    expect(isValidCustomHostname('shop.localhost')).toBe(false);
    expect(isValidCustomHostname('10.0.0.1')).toBe(false);
    expect(isValidCustomHostname('-bad.example.com')).toBe(false);
    expect(isValidCustomHostname('bad_.com')).toBe(false);
    expect(isValidCustomHostname('a..com')).toBe(false);
    expect(isValidCustomHostname(`${'a'.repeat(250)}.com`)).toBe(false);
    expect(isValidCustomHostname('site.example')).toBe(false);
  });

  it('rejects our own root domains and their subdomains', () => {
    expect(isValidCustomHostname('restropulse.in', ['restropulse.in'])).toBe(false);
    expect(isValidCustomHostname('demo.restropulse.in', ['restropulse.in'])).toBe(false);
    expect(isValidCustomHostname('myrestropulse.in', ['restropulse.in'])).toBe(true);
    expect(isValidCustomHostname('bawarchi.in', [''])).toBe(true);
  });
});

describe('slugFromSitesHost', () => {
  it('reads a one-label subdomain of the root', () => {
    expect(slugFromSitesHost('bawarchi.restropulse.in', 'restropulse.in')).toBe('bawarchi');
    expect(slugFromSitesHost('Bawarchi.RestroPulse.in:8080', 'restropulse.in')).toBe('bawarchi');
  });

  it('ignores the bare root, www, deeper names and other domains', () => {
    expect(slugFromSitesHost('restropulse.in', 'restropulse.in')).toBeNull();
    expect(slugFromSitesHost('www.restropulse.in', 'restropulse.in')).toBeNull();
    expect(slugFromSitesHost('a.b.restropulse.in', 'restropulse.in')).toBeNull();
    expect(slugFromSitesHost('bawarchi.in', 'restropulse.in')).toBeNull();
    expect(slugFromSitesHost('', 'restropulse.in')).toBeNull();
    expect(slugFromSitesHost('x.restropulse.in', '')).toBeNull();
  });
});

describe('verify record', () => {
  it('builds the TXT name and value', () => {
    expect(domainVerifyRecordName('www.bawarchi.in')).toBe('_restropulse.www.bawarchi.in');
    expect(domainVerifyRecordValue('abc')).toBe('restropulse-verify=abc');
  });
});
