/**
 * Shared plumbing for the storefront API clients (real + demo):
 * base URL resolution, ApiError, and the per-slug customer token/profile
 * store (memory + localStorage). Extracted from api.ts so demo-api.ts can
 * reuse it without a circular runtime import.
 */
import type { PublicCustomer } from '@restropulse/shared';

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || '/api';
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ----- Customer token store (memory + localStorage) -----

const tokenMemory = new Map<string, string>();

function tokenKey(slug: string): string {
  return `sf_token_${slug}`;
}

function customerKey(slug: string): string {
  return `sf_customer_${slug}`;
}

export function getToken(slug: string): string | null {
  const inMemory = tokenMemory.get(slug);
  if (inMemory) return inMemory;
  try {
    const stored = localStorage.getItem(tokenKey(slug));
    if (stored) tokenMemory.set(slug, stored);
    return stored;
  } catch {
    return null;
  }
}

export function setToken(slug: string, token: string): void {
  tokenMemory.set(slug, token);
  try { localStorage.setItem(tokenKey(slug), token); } catch { /* ignore */ }
}

export function clearToken(slug: string): void {
  tokenMemory.delete(slug);
  try {
    localStorage.removeItem(tokenKey(slug));
    localStorage.removeItem(customerKey(slug));
  } catch { /* ignore */ }
}

export function getStoredCustomer(slug: string): PublicCustomer | null {
  try {
    const raw = localStorage.getItem(customerKey(slug));
    return raw ? (JSON.parse(raw) as PublicCustomer) : null;
  } catch {
    return null;
  }
}

export function storeCustomer(slug: string, customer: PublicCustomer): void {
  try { localStorage.setItem(customerKey(slug), JSON.stringify(customer)); } catch { /* ignore */ }
}
