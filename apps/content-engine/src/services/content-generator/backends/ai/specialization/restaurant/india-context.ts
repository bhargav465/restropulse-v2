/**
 * Static reference data for India-specific restaurant content.
 * No time-varying data lives here -- dynamic festival lookup belongs in current-affairs/.
 * These are pure constants consumed by prompts.ts (system prompt) and sonar-queries.ts.
 */

export interface FestivalEntry {
  id: string;
  name: string;
  localNames: Partial<Record<'hi' | 'ta' | 'te' | 'ml' | 'bn' | 'pa', string>>;
  approxMonths: number[];          // 1-indexed; can span 2 months
  geographicScope: 'national' | 'regional';
  regions?: string[];
  foodExpression: string[];        // specific dishes / foods traditionally associated
  contentTone: 'celebratory' | 'devotional' | 'neutral';
  promotionalSensitivity: 'low' | 'medium' | 'high';
  // high = active fasting/mourning -- promotional food content is culturally inappropriate
  restaurantOpportunity: string;   // one-line content angle for restaurants
}

export const FESTIVAL_CALENDAR: FestivalEntry[] = [
  {
    id: 'diwali',
    name: 'Diwali',
    localNames: { hi: 'Diwali', ta: 'Deepavali', te: 'Deepavali', ml: 'Deepavali', bn: 'Deepaboli', pa: 'Diwali' },
    approxMonths: [10, 11],
    geographicScope: 'national',
    foodExpression: ['mithai', 'dry fruits', 'kheer', 'gulab jamun', 'kaju katli'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Festive combos, gifting platters, mithai boxes',
  },
  {
    id: 'holi',
    name: 'Holi',
    localNames: { hi: 'Holi', bn: 'Holi', pa: 'Holi' },
    approxMonths: [3],
    geographicScope: 'national',
    foodExpression: ['gujiya', 'thandai', 'malpua', 'puran poli'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Festive specials, colour-themed drinks, family platters',
  },
  {
    id: 'eid-ul-fitr',
    name: 'Eid ul-Fitr',
    localNames: { hi: 'Eid ul-Fitr' },
    approxMonths: [3, 4, 5],
    geographicScope: 'national',
    foodExpression: ['biryani', 'seviyan', 'sheer khurma', 'nihari', 'haleem'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Eid feast specials, biryani combos, festive thalis',
  },
  {
    id: 'eid-ul-adha',
    name: 'Eid ul-Adha',
    localNames: { hi: 'Eid ul-Adha' },
    approxMonths: [6, 7],
    geographicScope: 'national',
    foodExpression: ['mutton biryani', 'haleem', 'kebabs', 'qorma'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Grand feast menu, sharing platters, mutton specials',
  },
  {
    id: 'navratri',
    name: 'Navratri',
    localNames: { hi: 'Navratri', ta: 'Navaratri', te: 'Navaratri', bn: 'Navaratri', pa: 'Navratri' },
    approxMonths: [3, 4, 9, 10],
    geographicScope: 'national',
    foodExpression: ['sabudana khichdi', 'kuttu puri', 'singhara halwa', 'fruit chaat'],
    contentTone: 'devotional',
    promotionalSensitivity: 'high',
    restaurantOpportunity: 'Vrat/fasting-friendly menu, satvik dishes (separate page)',
  },
  {
    id: 'onam',
    name: 'Onam',
    localNames: { ml: 'Onam', ta: 'Onam' },
    approxMonths: [8, 9],
    geographicScope: 'regional',
    regions: ['Kerala', 'TN', 'KA'],
    foodExpression: ['sadhya (26-course banana leaf meal)', 'payasam', 'avial'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Kerala sadhya special, banana leaf experience, traditional thali',
  },
  {
    id: 'pongal',
    name: 'Pongal/Sankranti',
    localNames: { ta: 'Pongal', te: 'Sankranti', hi: 'Makar Sankranti' },
    approxMonths: [1],
    geographicScope: 'regional',
    regions: ['TN', 'AP', 'TG', 'KA'],
    foodExpression: ['pongal (sweet+spicy)', 'til ladoo', 'gajak', 'undhiyu'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Traditional harvest specials, til sweets, regional thali',
  },
  {
    id: 'baisakhi',
    name: 'Baisakhi',
    localNames: { hi: 'Baisakhi', pa: 'Vaisakhi' },
    approxMonths: [4],
    geographicScope: 'regional',
    regions: ['Punjab', 'Haryana', 'Delhi'],
    foodExpression: ['sarson da saag', 'makki roti', 'lassi', 'pinni'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Punjabi harvest feast, lassi specials, dhaba classics',
  },
  {
    id: 'bihu',
    name: 'Bihu',
    localNames: { hi: 'Bihu' },
    approxMonths: [4],
    geographicScope: 'regional',
    regions: ['Assam'],
    foodExpression: ['pitha', 'laru', 'fish curries'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Assamese special (skip if restaurant is not regional)',
  },
  {
    id: 'ugadi',
    name: 'Ugadi / Gudi Padwa',
    localNames: { te: 'Ugadi', ta: 'Ugadi', hi: 'Gudi Padwa' },
    approxMonths: [3, 4],
    geographicScope: 'regional',
    regions: ['AP', 'TG', 'KA', 'MH'],
    foodExpression: ['ugadi pachadi', 'puran poli', 'holige', 'obbattu'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'New year specials, traditional sweets combo',
  },
  {
    id: 'durga-puja',
    name: 'Durga Puja',
    localNames: { bn: 'Durga Puja', hi: 'Durga Puja' },
    approxMonths: [10],
    geographicScope: 'regional',
    regions: ['WB', 'Odisha', 'Assam'],
    foodExpression: ['kosha mangsho', 'hilsa', 'luchi', 'mishti doi'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Bengali festive thali, mishti combos',
  },
  {
    id: 'ganesh-chaturthi',
    name: 'Ganesh Chaturthi',
    localNames: { hi: 'Ganesh Chaturthi', te: 'Vinayaka Chavithi', ta: 'Vinayagar Chaturthi' },
    approxMonths: [8, 9],
    geographicScope: 'regional',
    regions: ['MH', 'KA', 'AP', 'TG'],
    foodExpression: ['modak (steamed+fried)', 'motichoor ladoo', 'karanji'],
    contentTone: 'devotional',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Prasad boxes, modak specials, festive dessert combos',
  },
  {
    id: 'christmas',
    name: 'Christmas',
    localNames: { hi: 'Christmas', ta: 'Christmas', ml: 'Christmas' },
    approxMonths: [12],
    geographicScope: 'national',
    foodExpression: ['plum cake', 'roast', 'mulled wine'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Christmas feast menu, plum cake, holiday combos',
  },
  {
    id: 'new-year',
    name: 'New Year',
    localNames: { hi: 'Naya Saal' },
    approxMonths: [12, 1],
    geographicScope: 'national',
    foodExpression: ['celebratory spreads', 'party platters', 'festive desserts'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'NYE dinner specials, party platters, countdown combos',
  },
  {
    id: 'valentines',
    name: "Valentine's Day",
    localNames: { hi: "Valentine's Day" },
    approxMonths: [2],
    geographicScope: 'national',
    foodExpression: ['chocolates', 'pastries', 'couple desserts'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: "Couple's set menu, intimate dining, dessert for two",
  },
  {
    id: 'independence-day',
    name: 'Independence Day',
    localNames: { hi: 'Swatantrata Diwas', ta: 'Sutatantiram Dhinam', te: 'Swatantrata Dinotsavam' },
    approxMonths: [8],
    geographicScope: 'national',
    foodExpression: ['tricolour sweets', 'kheer (white)', 'biryani (saffron)'],
    contentTone: 'neutral',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Tricolour special, patriotic combos, flag-inspired plating',
  },
  {
    id: 'republic-day',
    name: 'Republic Day',
    localNames: { hi: 'Gantantra Diwas' },
    approxMonths: [1],
    geographicScope: 'national',
    foodExpression: ['tricolour themed dishes', 'national thali'],
    contentTone: 'neutral',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Patriotic specials, themed thali',
  },
  {
    id: 'shravan',
    name: 'Shravan (month)',
    localNames: { hi: 'Shravan', ta: 'Avani', te: 'Sravana' },
    approxMonths: [7, 8],
    geographicScope: 'national',
    foodExpression: ['satvik food', 'no-onion-no-garlic dishes', 'fruits', 'dairy-based sweets'],
    contentTone: 'devotional',
    promotionalSensitivity: 'high',
    restaurantOpportunity: 'Avoid promoting non-vegetarian or heavy meat dishes; push satvik menu',
  },
  {
    id: 'pitru-paksha',
    name: 'Pitru Paksha (Shradh)',
    localNames: { hi: 'Pitru Paksha' },
    approxMonths: [9, 10],
    geographicScope: 'national',
    foodExpression: ['satvik food', 'kheer', 'puri (for rituals)'],
    contentTone: 'devotional',
    promotionalSensitivity: 'high',
    restaurantOpportunity: 'Avoid all festive/celebratory food promotion; satvik only',
  },
  {
    id: 'raksha-bandhan',
    name: 'Raksha Bandhan',
    localNames: { hi: 'Raksha Bandhan', pa: 'Rakhri' },
    approxMonths: [7, 8],
    geographicScope: 'national',
    foodExpression: ['mithai', 'chocolates', 'sweets'],
    contentTone: 'celebratory',
    promotionalSensitivity: 'low',
    restaurantOpportunity: 'Sibling celebration combos, sweet boxes, festive gifting',
  },
];

export interface RegionalAesthetic {
  surface: string;          // what the food sits on / near
  colours: string;          // colour palette to suggest
  props: string;            // additional props in frame
  avoidNote?: string;       // what to avoid for this region
}

export const REGIONAL_AESTHETICS: Record<string, RegionalAesthetic> = {
  'south-indian': {
    surface: 'banana leaf, weathered copper vessel, clay pot',
    colours: 'earthy green, terracotta, natural wood',
    props: 'coconut halves, curry leaves, steel tumbler, bronze lamp',
    avoidNote: 'Avoid marble or white linen -- too Western for South Indian aesthetic',
  },
  'north-indian': {
    surface: 'matte clay handi, carved dark wood, jute cloth',
    colours: 'saffron, deep red, ochre, turmeric yellow',
    props: 'copper thali, tandoor charcoal, rolling pin, dried red chillies',
  },
  'mughlai': {
    surface: 'dark copper serving dish, muted brocade, aged brass tray',
    colours: 'deep burgundy, gold, ivory, forest green',
    props: 'intricate silverware, rose petals, saffron strands, silver leaf',
  },
  'coastal': {
    surface: 'palm leaf, woven cane mat, sea-washed stone, banana leaf',
    colours: 'aqua, coral, natural white, warm sand',
    props: 'coconut shell, dried fish (decorative), terracotta bowls, sea glass',
  },
  'street-food': {
    surface: 'newspaper cone, stainless steel thali, iron tawa, oilpaper',
    colours: 'high contrast -- bright against dark background',
    props: 'chutney daubed, masala powder, street cart element, raw onion rings',
  },
  'cafe-modern': {
    surface: 'matte concrete, white ceramic, brushed steel',
    colours: 'muted earth tones, monochrome, sage green',
    props: 'single flower, linen napkin, minimal garnish',
  },
  'continental': {
    surface: 'white linen, fine china, dark slate',
    colours: 'white, charcoal, gold accent',
    props: 'wine glass, silver cutlery, microgreens, edible flowers',
  },
  'chinese-indian': {
    surface: 'dark wok, bamboo mat, lacquer tray',
    colours: 'red, black, gold -- Indo-Chinese vibrance',
    props: 'chopsticks (decorative), dim sum steamer, spring onion curls',
  },
  'default': {
    surface: 'neutral wooden board or marble surface',
    colours: 'warm neutral tones',
    props: 'fresh herbs, simple garnish',
  },
};

export function getRegionalAesthetic(cuisine: string | undefined): RegionalAesthetic {
  if (!cuisine) return REGIONAL_AESTHETICS['default'] as RegionalAesthetic;
  const lower = cuisine.toLowerCase();
  for (const [key, aesthetic] of Object.entries(REGIONAL_AESTHETICS)) {
    if (key !== 'default' && lower.includes(key.replace(/-/g, ' ').split(' ')[0])) {
      return aesthetic;
    }
  }
  return REGIONAL_AESTHETICS['default'] as RegionalAesthetic;
}

export const PRICE_REGISTER_GUIDE = {
  valueSignal: 'Use "great value" or "generous portions" -- not "cheap" or "affordable"',
  premiumSignal: 'Use "crafted", "hand-finished", "slow-cooked", "chef-curated" -- not "expensive" or "luxury"',
  midRangeSignal: 'Use "satisfying", "honest", "good food without the fuss"',
  priceAnchorTechnique: 'Compare to a familiar everyday spend: "Less than a weekend movie ticket" only when price is genuinely low',
  avoidPhrases: ['steal', 'dirt cheap', 'insanely affordable', 'super cheap', 'throwaway price'],
  avoidComparativeClaims: 'No false comparative pricing -- do not say "cheaper than X restaurant" or "half the price of Y"',
} as const;

export const VERNACULAR_POSTURE = {
  rule: 'Use transliterated phrases as flavour, not translation. Maximum one phrase per caption.',
  southIndianNote: 'For South Indian restaurants: prefer Tamil/Telugu/Kannada phrases over Hindi. Do not impose Hindi on South Indian content.',
  approved: [
    'Pure desi vibes -- no shortcuts.',
    'Ghar jaisa khana, restaurant ka andaaz.',
    'Ek baar try karo, baar baar aoge.',
    'Tadka maar ke serve kiya -- just like home.',
    'Sach mein, ek baar khaoge toh bhool nahi paoge.',
  ],
  avoid: [
    'Bahut hi tasty food yahan milta hai hamesha.',
    'Yahan ka khana bohot accha hai!',
  ],
} as const;

export const SONAR_CONTEXT_TERMS = {
  festivals: [
    'Indian festival food', 'festive season India restaurant',
    'traditional Indian sweets special', 'festival thali',
  ],
  trending: [
    'trending Indian street food', 'viral Indian recipe',
    'Indian food trend', 'popular restaurant dish India',
  ],
  regional: {
    hyderabad: ['Hyderabadi biryani', 'Old City food', 'Secunderabad restaurant', 'Hitech City lunch'],
    mumbai: ['Mumbai street food', 'Bandra restaurant', 'Marine Drive dining', 'Mumbai dabba'],
    bangalore: ['Bangalore cafe', 'Indiranagar restaurant', 'Koramangala food', 'JP Nagar dine'],
    chennai: ['Chennai filter coffee', 'T Nagar restaurant', 'Anna Nagar food', 'Chettinad Chennai'],
    delhi: ['Old Delhi food', 'Connaught Place restaurant', 'Hauz Khas dining', 'Delhi street food'],
  },
} as const;
