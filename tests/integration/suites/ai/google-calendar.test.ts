import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('google-calendar', ['GOOGLE_CALENDAR_API_KEY']);

describe('Google Calendar API — India holidays', () => {
  it('fetches India public holidays for the current month', async () => {
    const { GoogleCalendarClient } = await import('../../../../apps/content-engine/src/services/content-generator/backends/ai/current-affairs/clients/google-calendar-client.js');
    const client = new GoogleCalendarClient({ apiKey: secrets.GOOGLE_CALENDAR_API_KEY });
    const now = new Date();
    const holidays = await client.listHolidays(now.getFullYear(), now.getMonth() + 1);
    expect(Array.isArray(holidays)).toBe(true);
    for (const h of holidays) {
      expect(typeof h.name).toBe('string');
      // date is an ISO string (YYYY-MM-DD)
      expect(typeof h.date).toBe('string');
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }, 15000);
});
