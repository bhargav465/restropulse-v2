import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { normalizeIp, clientIp, clientIpKey } from '../../src/lib/client-ip.js';

const reqWithIp = (ip: string | undefined) => ({ ip, socket: { remoteAddress: '10.0.0.9' } }) as unknown as Request;

describe('normalizeIp', () => {
    it('strips the port Azure App Service appends to IPv4 X-Forwarded-For entries', () => {
        expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7');
    });

    it('strips brackets and port from IPv6', () => {
        expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
        expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
    });

    it('collapses IPv4-mapped IPv6 to plain IPv4', () => {
        expect(normalizeIp('::ffff:198.51.100.4')).toBe('198.51.100.4');
    });

    it('leaves plain addresses alone', () => {
        expect(normalizeIp('198.51.100.4')).toBe('198.51.100.4');
        expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('returns "unknown" for empty input', () => {
        expect(normalizeIp(undefined)).toBe('unknown');
        expect(normalizeIp('')).toBe('unknown');
        expect(normalizeIp('   ')).toBe('unknown');
    });
});

describe('clientIp / clientIpKey', () => {
    it('uses req.ip and normalises it', () => {
        expect(clientIp(reqWithIp('203.0.113.7:5000'))).toBe('203.0.113.7');
    });

    it('falls back to the socket address when req.ip is missing', () => {
        expect(clientIp(reqWithIp(undefined))).toBe('10.0.0.9');
    });

    it('gives the same key for the same IPv4 client on different ports', () => {
        expect(clientIpKey(reqWithIp('203.0.113.7:1111'))).toBe(clientIpKey(reqWithIp('203.0.113.7:2222')));
    });

    it('groups IPv6 clients by subnet so one host cannot rotate addresses', () => {
        const a = clientIpKey(reqWithIp('2001:db8:abcd:12::1'));
        const b = clientIpKey(reqWithIp('2001:db8:abcd:12:ffff::2'));
        expect(a).toBe(b);
    });
});
