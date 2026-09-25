/**
 * Local Media Catalog
 *
 * Defines the curated set of placeholder assets used by the dummy content generator.
 * All filenames are relative to the assets/ directory (images/ and videos/ subdirs).
 * URLs are constructed at runtime by asset-manager.ts using ASSET_SERVER_BASE_URL.
 *
 * To populate the assets/ directory, run: npm run download-assets
 */

export interface ImageAsset {
  id: string;
  filename: string;
  theme: string;
  widthPx: number;
  heightPx: number;
}

export interface VideoAsset {
  id: string;
  videoFilename: string;
  thumbnailFilename: string;
  theme: string;
  widthPx: number;
  heightPx: number;
  durationSeconds: number;
}

export interface CarouselSet {
  theme: string;
  filenames: string[];
  widthPx: number;
  heightPx: number;
}

// 24 themed placeholder images (4–5 per theme)
export const IMAGE_ASSETS: ImageAsset[] = [
  // Food & Menu — 5 images
  { id: 'food-01',  filename: 'food-01.jpg',  theme: 'Food & Menu',        widthPx: 800, heightPx: 800 },
  { id: 'food-02',  filename: 'food-02.jpg',  theme: 'Food & Menu',        widthPx: 800, heightPx: 800 },
  { id: 'food-03',  filename: 'food-03.jpg',  theme: 'Food & Menu',        widthPx: 800, heightPx: 800 },
  { id: 'food-04',  filename: 'food-04.jpg',  theme: 'Food & Menu',        widthPx: 800, heightPx: 800 },
  { id: 'food-05',  filename: 'food-05.jpg',  theme: 'Food & Menu',        widthPx: 800, heightPx: 800 },
  // Chef Specials — 4 images
  { id: 'chef-01',  filename: 'chef-01.jpg',  theme: 'Chef Specials',      widthPx: 800, heightPx: 800 },
  { id: 'chef-02',  filename: 'chef-02.jpg',  theme: 'Chef Specials',      widthPx: 800, heightPx: 800 },
  { id: 'chef-03',  filename: 'chef-03.jpg',  theme: 'Chef Specials',      widthPx: 800, heightPx: 800 },
  { id: 'chef-04',  filename: 'chef-04.jpg',  theme: 'Chef Specials',      widthPx: 800, heightPx: 800 },
  // Behind the Scenes — 4 images
  { id: 'bts-01',   filename: 'bts-01.jpg',   theme: 'Behind the Scenes',  widthPx: 800, heightPx: 800 },
  { id: 'bts-02',   filename: 'bts-02.jpg',   theme: 'Behind the Scenes',  widthPx: 800, heightPx: 800 },
  { id: 'bts-03',   filename: 'bts-03.jpg',   theme: 'Behind the Scenes',  widthPx: 800, heightPx: 800 },
  { id: 'bts-04',   filename: 'bts-04.jpg',   theme: 'Behind the Scenes',  widthPx: 800, heightPx: 800 },
  // Customer Stories — 4 images
  { id: 'cust-01',  filename: 'cust-01.jpg',  theme: 'Customer Stories',   widthPx: 800, heightPx: 800 },
  { id: 'cust-02',  filename: 'cust-02.jpg',  theme: 'Customer Stories',   widthPx: 800, heightPx: 800 },
  { id: 'cust-03',  filename: 'cust-03.jpg',  theme: 'Customer Stories',   widthPx: 800, heightPx: 800 },
  { id: 'cust-04',  filename: 'cust-04.jpg',  theme: 'Customer Stories',   widthPx: 800, heightPx: 800 },
  // Offers — 4 images
  { id: 'offer-01', filename: 'offer-01.jpg', theme: 'Offers',             widthPx: 800, heightPx: 800 },
  { id: 'offer-02', filename: 'offer-02.jpg', theme: 'Offers',             widthPx: 800, heightPx: 800 },
  { id: 'offer-03', filename: 'offer-03.jpg', theme: 'Offers',             widthPx: 800, heightPx: 800 },
  { id: 'offer-04', filename: 'offer-04.jpg', theme: 'Offers',             widthPx: 800, heightPx: 800 },
  // default — 3 images
  { id: 'default',    filename: 'default.jpg',    theme: 'default',        widthPx: 800, heightPx: 800 },
  { id: 'default-02', filename: 'default-02.jpg', theme: 'default',        widthPx: 800, heightPx: 800 },
  { id: 'default-03', filename: 'default-03.jpg', theme: 'default',        widthPx: 800, heightPx: 800 },
];

// Pre-defined carousel sets (3 images each) — 8 sets for good variety
export const CAROUSEL_SETS: CarouselSet[] = [
  { theme: 'Food & Menu',       filenames: ['food-01.jpg',  'food-02.jpg',  'food-03.jpg'],  widthPx: 800, heightPx: 800 },
  { theme: 'Food & Menu',       filenames: ['food-03.jpg',  'food-04.jpg',  'food-05.jpg'],  widthPx: 800, heightPx: 800 },
  { theme: 'Chef Specials',     filenames: ['chef-01.jpg',  'chef-02.jpg',  'chef-03.jpg'],  widthPx: 800, heightPx: 800 },
  { theme: 'Chef Specials',     filenames: ['chef-02.jpg',  'chef-03.jpg',  'chef-04.jpg'],  widthPx: 800, heightPx: 800 },
  { theme: 'Behind the Scenes', filenames: ['bts-01.jpg',   'bts-02.jpg',   'bts-03.jpg'],   widthPx: 800, heightPx: 800 },
  { theme: 'Behind the Scenes', filenames: ['bts-02.jpg',   'bts-03.jpg',   'bts-04.jpg'],   widthPx: 800, heightPx: 800 },
  { theme: 'Offers',            filenames: ['offer-01.jpg', 'offer-02.jpg', 'offer-03.jpg'], widthPx: 800, heightPx: 800 },
  { theme: 'Offers',            filenames: ['offer-02.jpg', 'offer-03.jpg', 'offer-04.jpg'], widthPx: 800, heightPx: 800 },
  { theme: 'Customer Stories',  filenames: ['cust-01.jpg',  'cust-02.jpg',  'cust-03.jpg'],  widthPx: 800, heightPx: 800 },
  { theme: 'default',           filenames: ['default.jpg',  'food-01.jpg',  'offer-01.jpg'], widthPx: 800, heightPx: 800 },
];

// 6 themed placeholder videos with matching thumbnails (2 per primary theme)
export const VIDEO_ASSETS: VideoAsset[] = [
  {
    id: 'food-vid-01',
    videoFilename: 'food-video-01.mp4',
    thumbnailFilename: 'food-video-01-thumb.jpg',
    theme: 'Food & Menu',
    widthPx: 1080,
    heightPx: 1920,
    durationSeconds: 30,
  },
  {
    id: 'food-vid-02',
    videoFilename: 'food-video-02.mp4',
    thumbnailFilename: 'food-video-02-thumb.jpg',
    theme: 'Food & Menu',
    widthPx: 1080,
    heightPx: 1920,
    durationSeconds: 30,
  },
  {
    id: 'chef-vid-01',
    videoFilename: 'chef-video-01.mp4',
    thumbnailFilename: 'chef-video-01-thumb.jpg',
    theme: 'Chef Specials',
    widthPx: 1080,
    heightPx: 1920,
    durationSeconds: 30,
  },
  {
    id: 'chef-vid-02',
    videoFilename: 'chef-video-02.mp4',
    thumbnailFilename: 'chef-video-02-thumb.jpg',
    theme: 'Chef Specials',
    widthPx: 1080,
    heightPx: 1920,
    durationSeconds: 30,
  },
  {
    id: 'bts-vid-01',
    videoFilename: 'bts-video-01.mp4',
    thumbnailFilename: 'bts-video-01-thumb.jpg',
    theme: 'Behind the Scenes',
    widthPx: 1080,
    heightPx: 1920,
    durationSeconds: 30,
  },
  {
    id: 'default-vid',
    videoFilename: 'default-video.mp4',
    thumbnailFilename: 'default-video-thumb.jpg',
    theme: 'default',
    widthPx: 1080,
    heightPx: 1920,
    durationSeconds: 30,
  },
];

// Caption templates per theme; {restaurant} and {concept} are substituted at runtime
export const CAPTION_TEMPLATES: Record<string, string[]> = {
  'Food & Menu': [
    'Every bite tells a story at {restaurant}. Come taste ours. 🍽️ #{concept}',
    'Fresh. Flavorful. Unforgettable. {concept} — only at {restaurant}. 😋',
    'Good food is the foundation of genuine happiness — {restaurant} 🌿',
    'Made with love, served with pride. {concept} at {restaurant}. 🍴',
  ],
  'Chef Specials': [
    "Chef's pick of the day at {restaurant}: {concept}. Limited portions — don't miss out! 👨‍🍳",
    "A masterpiece on every plate. Today's special at {restaurant}: {concept} ✨",
    'Crafted by our expert kitchen team — {concept} is live at {restaurant}. 🔥',
  ],
  'Behind the Scenes': [
    'The magic happens in the kitchen at {restaurant}. Take a peek! 🔥 #{concept}',
    'Passion, craft, and care — that\'s what we put into every dish at {restaurant}. 🍳',
    'From prep to plate — a glimpse into the heart of {restaurant}. 🫶 #{concept}',
  ],
  'Customer Stories': [
    'Nothing makes us happier than happy guests. Thank you for dining with us at {restaurant}! ❤️',
    'Your smiles are our motivation. See you again soon at {restaurant}! 🙌',
    'Every table has a story. Thank you for making ours so special at {restaurant}. 💛',
  ],
  'Offers': [
    'Special offer at {restaurant}: {concept}. Don\'t miss out! 🎉',
    'Treat yourself without breaking the bank — {concept}, only at {restaurant}. 💫',
    'Limited-time deal at {restaurant}! {concept}. Book your table now. 🏷️',
  ],
  default: [
    '{concept} — fresh from {restaurant}. 🌟',
    'Creating memories, one dish at a time at {restaurant}. 🍴 #{concept}',
    'Discover what makes {restaurant} special. {concept} 🌿',
  ],
};
