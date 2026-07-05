/**
 * Storefront API client — all calls are scoped to /api/storefront/:slug.
 * Follows apps/web/api.ts conventions (thin fetch wrapper + grouped API objects).
 * Customer JWT is kept in memory and mirrored to localStorage per slug.
 *
 * DEMO MODE: when built with VITE_DEMO_MODE=true the exported API objects are
 * swapped for the fixtures-backed implementations in demo-api.ts (no network,
 * no backend). Consumers keep importing from this module either way — the
 * `typeof real*` annotations below guarantee both clients expose the exact
 * same interface.
 */
import type {
  ApiResponse,
  CustomerAddress,
  Order,
  OrderAddress,
  OrderType,
  PublicCustomer,
} from '@restropulse/shared';
import type { OrderTrackingInfo, PublicMenuCategory, StorefrontConfig } from './types';
import { ApiError, clearToken, getApiBaseUrl, getToken, setToken, storeCustomer } from './lib/api-core';
import { isDemoMode } from './lib/demo';
import * as demoApi from './demo-api';

// Base URL, ApiError and the customer token store live in lib/api-core.ts
// (shared with demo-api.ts); re-exported so consumers keep one import site.
export {
  ApiError,
  clearToken,
  getApiBaseUrl,
  getStoredCustomer,
  getToken,
  setToken,
  storeCustomer,
} from './lib/api-core';

// ----- Fetch helper -----

interface RequestOpts {
  auth?: boolean;
  headers?: Record<string, string>;
}

async function request<T>(
  slug: string,
  endpoint: string,
  init: RequestInit = {},
  opts: RequestOpts = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (opts.auth) {
    const token = getToken(slug);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `${getApiBaseUrl()}/storefront/${encodeURIComponent(slug)}${endpoint}`,
    { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } },
  );

  const body = (await response.json().catch(() => ({}))) as ApiResponse<unknown>;

  if (!response.ok) {
    if (response.status === 401 && opts.auth) {
      clearToken(slug);
    }
    throw new ApiError(body.error || body.message || `HTTP ${response.status}`, response.status);
  }

  return body as T;
}

// ----- Public: config + menu -----

const realStorefrontAPI = {
  getConfig: async (slug: string): Promise<StorefrontConfig> => {
    const res = await request<ApiResponse<StorefrontConfig>>(slug, '/config');
    return res.data!;
  },

  getMenu: async (slug: string): Promise<PublicMenuCategory[]> => {
    const res = await request<ApiResponse<{ categories: PublicMenuCategory[] }>>(slug, '/menu');
    return res.data!.categories;
  },
};

// ----- Customer auth -----

export interface CustomerAuthResult {
  customer: PublicCustomer;
  token: string;
  refreshToken: string;
}

const realCustomerAuthAPI = {
  register: async (
    slug: string,
    data: { email: string; password: string; name?: string; phone?: string },
  ): Promise<CustomerAuthResult> => {
    const res = await request<ApiResponse<CustomerAuthResult>>(slug, '/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setToken(slug, res.data!.token);
    storeCustomer(slug, res.data!.customer);
    return res.data!;
  },

  login: async (slug: string, email: string, password: string): Promise<CustomerAuthResult> => {
    const res = await request<ApiResponse<CustomerAuthResult>>(slug, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(slug, res.data!.token);
    storeCustomer(slug, res.data!.customer);
    return res.data!;
  },

  me: async (slug: string): Promise<PublicCustomer> => {
    const res = await request<ApiResponse<PublicCustomer>>(slug, '/me', {}, { auth: true });
    storeCustomer(slug, res.data!);
    return res.data!;
  },

  logout: (slug: string): void => {
    clearToken(slug);
  },
};

// ----- Addresses -----

const realAddressAPI = {
  list: async (slug: string): Promise<CustomerAddress[]> => {
    const res = await request<ApiResponse<CustomerAddress[]>>(slug, '/addresses', {}, { auth: true });
    return res.data ?? [];
  },

  add: async (slug: string, address: Omit<CustomerAddress, 'id'>): Promise<CustomerAddress> => {
    const res = await request<ApiResponse<CustomerAddress>>(slug, '/addresses', {
      method: 'POST',
      body: JSON.stringify(address),
    }, { auth: true });
    return res.data!;
  },
};

// ----- Orders -----

export interface PlaceOrderPayload {
  items: Array<{ menuItemId: string; qty: number; variantId?: string; addonIds?: string[] }>;
  orderType: OrderType;
  address?: OrderAddress;
  notes?: string;
}

const realOrderAPI = {
  place: async (slug: string, payload: PlaceOrderPayload, idempotencyKey: string): Promise<Order> => {
    const res = await request<ApiResponse<Order>>(slug, '/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, { auth: true, headers: { 'Idempotency-Key': idempotencyKey } });
    return res.data!;
  },

  list: async (slug: string): Promise<Order[]> => {
    const res = await request<ApiResponse<Order[]>>(slug, '/orders', {}, { auth: true });
    return res.data ?? [];
  },

  get: async (slug: string, orderId: string): Promise<Order> => {
    const res = await request<ApiResponse<Order>>(slug, `/orders/${orderId}`, {}, { auth: true });
    return res.data!;
  },

  track: async (
    slug: string,
    orderId: string,
    fallback?: { orderNumber: string; phone: string },
  ): Promise<OrderTrackingInfo> => {
    const query = fallback
      ? `?orderNumber=${encodeURIComponent(fallback.orderNumber)}&phone=${encodeURIComponent(fallback.phone)}`
      : '';
    const res = await request<ApiResponse<OrderTrackingInfo>>(
      slug,
      `/orders/${orderId}/track${query}`,
      {},
      { auth: true },
    );
    return res.data!;
  },
};

// ----- Reservations -----

export interface ReservationPayload {
  date: string;
  time: string;
  partySize: number;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}

const realReservationAPI = {
  create: async (slug: string, payload: ReservationPayload): Promise<void> => {
    await request<ApiResponse>(slug, '/reservations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

// ----- Demo-mode switch -----
// Resolved once at module load: VITE_DEMO_MODE is a build-time constant.

const demo = isDemoMode();

export const storefrontAPI: typeof realStorefrontAPI = demo ? demoApi.storefrontAPI : realStorefrontAPI;
export const customerAuthAPI: typeof realCustomerAuthAPI = demo ? demoApi.customerAuthAPI : realCustomerAuthAPI;
export const addressAPI: typeof realAddressAPI = demo ? demoApi.addressAPI : realAddressAPI;
export const orderAPI: typeof realOrderAPI = demo ? demoApi.orderAPI : realOrderAPI;
export const reservationAPI: typeof realReservationAPI = demo ? demoApi.reservationAPI : realReservationAPI;
