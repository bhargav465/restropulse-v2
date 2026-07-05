import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('razorpay', ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']);

const authHeader = () =>
  'Basic ' + Buffer.from(`${secrets.RAZORPAY_KEY_ID}:${secrets.RAZORPAY_KEY_SECRET}`).toString('base64');

describe('Razorpay API connectivity (read-only)', () => {
  it('authenticates and lists subscription plans', async () => {
    const res = await fetch('https://api.razorpay.com/v1/plans?count=5', {
      headers: { Authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(Array.isArray(json.items)).toBe(true);
  }, 15000);

  it('rejects invalid credentials with 401', async () => {
    const res = await fetch('https://api.razorpay.com/v1/plans', {
      headers: { Authorization: 'Basic ' + Buffer.from('bad:creds').toString('base64') },
    });
    expect(res.status).toBe(401);
  }, 15000);
});
