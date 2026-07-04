/**
 * Client-side view types for the public storefront API
 * (shapes returned by /api/storefront/:slug/*).
 */
import type {
  MenuItemAddon,
  MenuItemVariant,
  RestaurantOrderingSettings,
  StorefrontContent,
} from '@restropulse/shared';

export interface PublicMenuItem {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  images: string[];
  isVeg: boolean;
  variants: MenuItemVariant[];
  addons: MenuItemAddon[];
  sortOrder: number;
  soldOut: boolean;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  items: PublicMenuItem[];
}

export interface StorefrontRestaurantInfo {
  id: string;
  name: string;
  slug: string;
  cuisine?: string;
  storeOpen: boolean;
  ordering: RestaurantOrderingSettings | null;
}

export interface StorefrontConfig {
  restaurant: StorefrontRestaurantInfo;
  content: StorefrontContent | null;
  storeOpen: boolean;
}

export interface OrderTrackingInfo {
  orderNumber: string;
  status: string;
  orderType: string;
  statusHistory: Array<{ status: string; at: string; note?: string }>;
  placedAt: string;
}
