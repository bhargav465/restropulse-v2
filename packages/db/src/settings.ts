/**
 * @restropulse/db - App settings helpers.
 *
 * A single `settings` collection holds operator-editable configuration as a
 * singleton document (`_id: 'app'`). Values are DB-configurable at runtime
 * without a redeploy. Each accessor falls back to a safe default when the
 * document or key is absent.
 */

import { getSettingsCollection } from './connection.js';

const SETTINGS_ID = 'app';

/** Default free-trial length (days) when not configured in the DB. */
export const DEFAULT_TRIAL_DAYS = 14;

export interface AppSettings {
  /** Length of the no-card, full-feature free trial granted at onboarding. */
  trialDays?: number;
}

/** Read the whole settings document (empty object when unset). */
export async function getAppSettings(): Promise<AppSettings> {
  const col = getSettingsCollection();
  const doc = await col.findOne({ _id: SETTINGS_ID as any });
  return (doc as AppSettings | null) ?? {};
}

/**
 * DB-configurable free-trial length in days. Falls back to DEFAULT_TRIAL_DAYS
 * when unset or invalid. Operators change it via the `settings` document.
 */
export async function getTrialDays(): Promise<number> {
  const { trialDays } = await getAppSettings();
  return typeof trialDays === 'number' && trialDays > 0 ? trialDays : DEFAULT_TRIAL_DAYS;
}

/** Upsert one or more settings keys on the singleton document. */
export async function setAppSettings(updates: Partial<AppSettings>): Promise<void> {
  const col = getSettingsCollection();
  await col.updateOne(
    { _id: SETTINGS_ID as any },
    { $set: { ...updates, updatedAt: new Date() } },
    { upsert: true },
  );
}
