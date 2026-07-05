import type { SpecializationContext } from '../types.js';

const BROAD_TAGS = ['#foodie', '#foodlover', '#instafood', '#foodphotography', '#foodgram'];

const CUISINE_TAGS_BY_KEYWORD: Record<string, string[]> = {
  south: ['#southindianfood', '#southindiancuisine', '#dosa', '#idli'],
  north: ['#northindianfood', '#punjabifood'],
  italian: ['#italianfood', '#pasta', '#pizza'],
  chinese: ['#chinesefood', '#indochinese'],
  multi: ['#indianfood', '#indiancuisine'],
};

const DENYLIST = new Set([
  '#like4like', '#follow4follow', '#l4l', '#f4f', '#tagsforlikes', '#followforfollow',
]);

function lower(s: string): string {
  return s.toLowerCase();
}

function locationTags(region?: string): string[] {
  if (!region) return [];
  const slug = region.toLowerCase().replace(/[^a-z]/g, '');
  return [`#${slug}food`, `#${slug}foodie`, `#${slug}`];
}

function cuisineTags(cuisine?: string): string[] {
  if (!cuisine) return CUISINE_TAGS_BY_KEYWORD.multi;
  const c = cuisine.toLowerCase();
  for (const key of Object.keys(CUISINE_TAGS_BY_KEYWORD)) {
    if (c.includes(key)) return CUISINE_TAGS_BY_KEYWORD[key];
  }
  return CUISINE_TAGS_BY_KEYWORD.multi;
}

export function selectRestaurantHashtags(_caption: string, ctx: SpecializationContext): string[] {
  const merged = [
    ...BROAD_TAGS.slice(0, 2),
    ...cuisineTags(ctx.cuisine).slice(0, 2),
    ...locationTags(ctx.region).slice(0, 3),
  ]
    .map(lower)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter((t) => !DENYLIST.has(t));

  const target = Math.min(8, Math.max(5, merged.length));
  return merged.slice(0, target);
}
