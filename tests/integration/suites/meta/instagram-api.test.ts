import { describe, it, expect } from 'vitest';
import { optionalSecrets } from '../../helpers/secrets.js';

// INSTAGRAM_TEST_ACCESS_TOKEN requires a live connected Instagram Business account
// and cannot be provisioned like a standard API key — skip silently when absent.
const secrets = optionalSecrets([
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_TEST_ACCESS_TOKEN',
]);

describe.skipIf(secrets === null)('Instagram Graph API (read-only)', () => {
  it('validates the test access token', async () => {
    const url = `https://graph.facebook.com/debug_token?input_token=${secrets.INSTAGRAM_TEST_ACCESS_TOKEN}&access_token=${secrets.INSTAGRAM_APP_ID}|${secrets.INSTAGRAM_APP_SECRET}`;
    const res = await fetch(url);
    const json = await res.json() as any;
    expect(json.data?.is_valid).toBe(true);
    expect(json.data?.app_id).toBe(secrets.INSTAGRAM_APP_ID);
  });

  it('fetches the connected account profile', async () => {
    const url = `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${secrets.INSTAGRAM_TEST_ACCESS_TOKEN}`;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const json = await res.json() as any;
    expect(typeof json.id).toBe('string');
  });
});
