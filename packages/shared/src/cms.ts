// -------------------------------------------------------
// @restropulse/shared - pure CMS logic (no I/O)
//
// Shared by the API (admin CMS routes), db-cli (menu migration) and the
// content engine (offers -> activeOffers). Everything here is deterministic
// given its inputs so it can be unit tested without MongoDB.
// -------------------------------------------------------

import type { MenuItem } from './index.js';
import type {
  MenuCategory,
  MenuItemAvailability,
  Offer,
  OrderingMenuItem,
  StorefrontContent,
  StorefrontContentDoc,
  StorefrontVersionEntry,
  Weekday,
} from './ordering.js';
import { STOREFRONT_VERSION_HISTORY_LIMIT } from './ordering.js';

/** Restaurants are India-only today; every schedule is evaluated in IST unless told otherwise. */
export const DEFAULT_RESTAURANT_TIME_ZONE = 'Asia/Kolkata';

// ============================================
// Menu: legacy projection + migration
// ============================================

/**
 * Project the canonical catalog (menu_categories + menu_items) onto the legacy
 * embedded `restaurant.menu` shape the content engine and grader read.
 * Hidden items are dropped; out-of-stock items stay with `isAvailable: false`
 * (the content engine already filters on that flag). Order follows category
 * sortOrder, then item sortOrder, then name.
 */
export function projectLegacyMenu(categories: MenuCategory[], items: OrderingMenuItem[]): MenuItem[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const rank = (c: MenuCategory | undefined) => (c ? c.sortOrder : Number.MAX_SAFE_INTEGER);

  return items
    .filter((item) => item.availability !== 'hidden')
    .map((item) => ({ item, category: categoryById.get(item.categoryId) }))
    .sort((a, b) =>
      rank(a.category) - rank(b.category)
      || (a.category?.name ?? '').localeCompare(b.category?.name ?? '')
      || a.item.sortOrder - b.item.sortOrder
      || a.item.name.localeCompare(b.item.name))
    .map(({ item, category }) => {
      const projected: MenuItem = {
        id: item.id,
        category: category?.name ?? 'Other',
        name: item.name,
        price: item.price,
        isVeg: item.isVeg,
        isAvailable: item.availability === 'in_stock',
      };
      if (item.description) projected.description = item.description;
      if (item.isBestSeller) projected.isBestSeller = true;
      return projected;
    });
}

export interface CatalogDraftCategory {
  name: string;
  sortOrder: number;
}

export interface CatalogDraftItem {
  categoryName: string;
  name: string;
  description?: string;
  price: number;
  isVeg: boolean;
  isBestSeller?: boolean;
  availability: MenuItemAvailability;
  sortOrder: number;
}

export interface CatalogDraft {
  categories: CatalogDraftCategory[];
  items: CatalogDraftItem[];
  /** Item names skipped because an earlier entry already used them (names are unique per restaurant). */
  duplicateNames: string[];
}

/**
 * Turn a legacy embedded menu into catalog rows (one-off migration, db-cli
 * `migrate --migration menu-to-catalog`). Categories keep first-seen order;
 * a missing category becomes "Other"; a missing price becomes 0 (the merchant
 * fixes it in the CMS). Item names are de-duplicated case-sensitively, matching
 * the unique (restaurantId, name) index.
 */
export function embeddedMenuToCatalog(menu: MenuItem[] | undefined): CatalogDraft {
  const categories: CatalogDraftCategory[] = [];
  const categoryIndex = new Map<string, number>();
  const seen = new Set<string>();
  const duplicateNames: string[] = [];
  const items: CatalogDraftItem[] = [];
  const perCategoryCount = new Map<string, number>();

  for (const entry of menu ?? []) {
    const name = (entry.name ?? '').trim();
    if (!name) continue;
    if (seen.has(name)) {
      duplicateNames.push(name);
      continue;
    }
    seen.add(name);

    const categoryName = (entry.category ?? '').trim() || 'Other';
    const key = categoryName.toLowerCase();
    if (!categoryIndex.has(key)) {
      categoryIndex.set(key, categories.length);
      categories.push({ name: categoryName, sortOrder: categories.length + 1 });
    }
    const canonicalCategory = categories[categoryIndex.get(key)!].name;
    const position = (perCategoryCount.get(key) ?? 0) + 1;
    perCategoryCount.set(key, position);

    const price = Number(entry.price);
    const item: CatalogDraftItem = {
      categoryName: canonicalCategory,
      name,
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      isVeg: entry.isVeg === true,
      availability: entry.isAvailable === false ? 'out_of_stock' : 'in_stock',
      sortOrder: position,
    };
    if (entry.description?.trim()) item.description = entry.description.trim();
    if (entry.isBestSeller) item.isBestSeller = true;
    items.push(item);
  }

  return { categories, items, duplicateNames };
}

// ============================================
// Offers
// ============================================

const WEEKDAY_BY_SHORT: Record<string, Weekday> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
};

/** Weekday and minutes-since-midnight of `at` in `timeZone`. */
export function localClock(at: Date, timeZone: string = DEFAULT_RESTAURANT_TIME_ZONE): { day: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: WEEKDAY_BY_SHORT[get('weekday')] ?? 'mon',
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHhMm(value: string): boolean {
  return HHMM.test(value);
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** True when `minutes` falls in [from, to); a window with from > to wraps past midnight. */
export function inDailyWindow(minutes: number, from: string, to: string): boolean {
  const start = hhmmToMinutes(from);
  const end = hhmmToMinutes(to);
  if (start === end) return true; // a zero-length window means "all day"
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Upper-case, trimmed coupon code; undefined for blank. */
export function normaliseOfferCode(code: string | undefined | null): string | undefined {
  const trimmed = (code ?? '').trim().toUpperCase();
  return trimmed ? trimmed : undefined;
}

/**
 * Is the offer redeemable at `now`? Checks status, the start/end dates, and the
 * optional weekday + daily time window in the restaurant's local time.
 */
export function isOfferLive(offer: Offer, now: Date = new Date(), timeZone: string = DEFAULT_RESTAURANT_TIME_ZONE): boolean {
  if (offer.status !== 'active') return false;
  const { startsAt, endsAt, days, from, to } = offer.schedule;
  const t = now.getTime();
  if (Number.isFinite(Date.parse(startsAt)) && t < Date.parse(startsAt)) return false;
  if (endsAt && Number.isFinite(Date.parse(endsAt)) && t >= Date.parse(endsAt)) return false;

  if ((days && days.length > 0) || (from && to)) {
    const clock = localClock(now, timeZone);
    if (days && days.length > 0 && !days.includes(clock.day)) return false;
    if (from && to && !inDailyWindow(clock.minutes, from, to)) return false;
  }
  return true;
}

/** Active and not yet ended -- ignores today's weekday/time window (posts promote upcoming slots too). */
export function isOfferPromotable(offer: Offer, now: Date = new Date()): boolean {
  if (offer.status !== 'active' || !offer.promoteInContent) return false;
  const endsAt = offer.schedule.endsAt;
  return !(endsAt && Number.isFinite(Date.parse(endsAt)) && now.getTime() >= Date.parse(endsAt));
}

const DAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function formatInr(amount: number): string {
  return `₹${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function describeDays(days: Weekday[] | undefined): string | null {
  if (!days || days.length === 0 || days.length === 7) return null;
  const weekdays: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (days.length === 5 && weekdays.every((d) => days.includes(d))) return 'weekdays';
  if (days.length === 2 && days.includes('sat') && days.includes('sun')) return 'weekends';
  return [...days].sort((a, b) => weekdays.concat(['sat', 'sun']).indexOf(a) - weekdays.concat(['sat', 'sun']).indexOf(b))
    .map((d) => DAY_LABEL[d]).join(', ');
}

/**
 * One-line human summary, e.g.
 * "Weekday lunch: 15% off (up to ₹150) on orders above ₹500, weekdays 12:00-15:00. Code LUNCH15"
 * Used for the content engine's `activeOffers` and the admin list.
 */
export function describeOffer(offer: Offer): string {
  const r = offer.reward;
  let reward: string;
  if (r.kind === 'percent_off') {
    reward = `${r.percent}% off${r.maxDiscount ? ` (up to ${formatInr(r.maxDiscount)})` : ''}`;
  } else if (r.kind === 'flat_off') {
    reward = `${formatInr(r.amount)} off`;
  } else {
    reward = 'free delivery';
  }
  const parts = [reward];
  if (offer.minOrderValue && offer.minOrderValue > 0) parts.push(`on orders above ${formatInr(offer.minOrderValue)}`);
  const when = [describeDays(offer.schedule.days), offer.schedule.from && offer.schedule.to ? `${offer.schedule.from}-${offer.schedule.to}` : null]
    .filter(Boolean).join(' ');
  let text = `${offer.title.trim()}: ${parts.join(' ')}${when ? `, ${when}` : ''}`;
  if (offer.code) text += `. Code ${offer.code}`;
  return text;
}

/**
 * The `activeOffers` list the content engine should see: the merchant's
 * free-text offers from the Updates screen first, then every promotable CMS
 * offer, de-duplicated.
 */
export function mergeActiveOffers(manual: string[] | undefined, offers: Offer[], now: Date = new Date()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of [...(manual ?? []), ...offers.filter((o) => isOfferPromotable(o, now)).map(describeOffer)]) {
    const key = text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text.trim());
  }
  return out;
}

export interface OfferLine {
  menuItemId: string;
  categoryId: string;
  lineTotal: number;
}

export interface OfferDiscount {
  /** Discount on the food subtotal (INR, rounded to paise). */
  discount: number;
  /** Discount on the delivery fee (INR). */
  deliveryDiscount: number;
  /** Why the offer gave nothing, when it gave nothing. */
  reason?: 'not_live' | 'below_min_order' | 'no_eligible_items';
}

const roundPaise = (n: number) => Math.round(n * 100) / 100;

/**
 * Discount the offer gives on an order. Pure: the caller supplies resolved
 * server-side line totals (never client prices). Used by checkout in milestone 2
 * and by the admin "preview" in the CMS.
 */
export function computeOfferDiscount(
  offer: Offer,
  input: { lines: OfferLine[]; deliveryFee: number; now?: Date; timeZone?: string },
): OfferDiscount {
  if (!isOfferLive(offer, input.now ?? new Date(), input.timeZone)) return { discount: 0, deliveryDiscount: 0, reason: 'not_live' };

  const subtotal = input.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  if (offer.minOrderValue && subtotal < offer.minOrderValue) {
    return { discount: 0, deliveryDiscount: 0, reason: 'below_min_order' };
  }

  const scope = offer.scope;
  const eligible = input.lines.filter((l) =>
    scope.kind === 'all'
    || (scope.kind === 'categories' && scope.categoryIds.includes(l.categoryId))
    || (scope.kind === 'items' && scope.itemIds.includes(l.menuItemId)));
  const eligibleTotal = eligible.reduce((sum, l) => sum + l.lineTotal, 0);

  const reward = offer.reward;
  if (reward.kind === 'free_delivery') {
    return { discount: 0, deliveryDiscount: roundPaise(Math.max(0, input.deliveryFee)) };
  }
  if (eligibleTotal <= 0) return { discount: 0, deliveryDiscount: 0, reason: 'no_eligible_items' };

  let discount = reward.kind === 'percent_off'
    ? (eligibleTotal * reward.percent) / 100
    : reward.amount;
  if (reward.kind === 'percent_off' && reward.maxDiscount !== undefined) discount = Math.min(discount, reward.maxDiscount);
  discount = Math.min(discount, eligibleTotal);
  return { discount: roundPaise(discount), deliveryDiscount: 0 };
}

// ============================================
// Site content: normalise, publish, rollback
// ============================================

export const EMPTY_STOREFRONT_CONTENT: StorefrontContent = { heroImages: [] };

/**
 * Normalise content read from storage or the Vercel-line shape: legacy
 * `gallery: string[]` becomes `GalleryImage[]`, and `heroImages` is always an array.
 */
export function normaliseStorefrontContent(raw: unknown): StorefrontContent {
  const content = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  content.heroImages = Array.isArray(content.heroImages)
    ? (content.heroImages as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  if (Array.isArray(content.gallery)) {
    content.gallery = (content.gallery as unknown[])
      .map((g) => (typeof g === 'string' ? { url: g } : g))
      .filter((g): g is { url: string } => !!g && typeof (g as { url?: unknown }).url === 'string');
  }
  return content as unknown as StorefrontContent;
}

export interface PublishResult {
  published: StorefrontContent;
  publishedVersion: number;
  publishedAt: string;
  versions: StorefrontVersionEntry[];
}

/** Snapshot the draft as the next published version, newest first, history capped. */
export function publishStorefrontDraft(
  doc: Pick<StorefrontContentDoc, 'draft' | 'publishedVersion' | 'versions'>,
  now: Date = new Date(),
): PublishResult {
  const versions = doc.versions ?? [];
  const highest = versions.reduce((max, v) => Math.max(max, v.version), doc.publishedVersion ?? 0);
  const publishedVersion = highest + 1;
  const publishedAt = now.toISOString();
  const published = normaliseStorefrontContent(doc.draft);
  return {
    published,
    publishedVersion,
    publishedAt,
    versions: [{ version: publishedVersion, publishedAt, content: published }, ...versions]
      .slice(0, STOREFRONT_VERSION_HISTORY_LIMIT),
  };
}

/**
 * Re-publish an earlier version as a NEW version (history is append-only, so a
 * rollback can itself be rolled back). Returns null when the version is gone.
 * The draft is reset to the restored content so the editor matches the site.
 */
export function rollbackStorefront(
  doc: Pick<StorefrontContentDoc, 'draft' | 'publishedVersion' | 'versions'>,
  version: number,
  now: Date = new Date(),
): (PublishResult & { draft: StorefrontContent }) | null {
  const target = (doc.versions ?? []).find((v) => v.version === version);
  if (!target) return null;
  const result = publishStorefrontDraft({ ...doc, draft: target.content }, now);
  return { ...result, draft: result.published };
}
