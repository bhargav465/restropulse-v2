/**
 * Local Media Catalog
 *
 * Defines the curated set of placeholder assets used by the dummy content
 * generator. All filenames are relative to the assets/ directory (images/ and
 * videos/ subdirs); URLs are constructed at runtime by asset-manager.ts using
 * ASSET_SERVER_BASE_URL. To populate the binary assets, run the asset server /
 * download step — this module only carries the metadata.
 *
 * Reconstructed for the v2 monorepo: the `assets/` directory was dropped during
 * the history-less baxeltech snapshot import, which broke `asset-manager.ts`.
 * v2's asset-manager filters by MediaConstraints, so ImageAsset/VideoAsset carry
 * pixel dimensions (and videos a duration) that upstream's catalog lacked. Ids,
 * filenames, carousel sets and caption templates match upstream so restored
 * binaries line up. Dimensions are the standard Instagram square-feed / vertical
 * placeholder sizes — [SAMPLE] metadata for demo content generation.
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

// Standard Instagram feed placeholder size (1:1). [SAMPLE]
const IMG_W = 1080;
const IMG_H = 1080;

// 24 themed placeholder images (4–5 per theme)
export const IMAGE_ASSETS: ImageAsset[] = [
  // Food & Menu — 5 images
  { id: 'food-01',  filename: 'food-01.jpg',  theme: 'Food & Menu', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'food-02',  filename: 'food-02.jpg',  theme: 'Food & Menu', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'food-03',  filename: 'food-03.jpg',  theme: 'Food & Menu', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'food-04',  filename: 'food-04.jpg',  theme: 'Food & Menu', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'food-05',  filename: 'food-05.jpg',  theme: 'Food & Menu', widthPx: IMG_W, heightPx: IMG_H },
  // Chef Specials — 4 images
  { id: 'chef-01',  filename: 'chef-01.jpg',  theme: 'Chef Specials', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'chef-02',  filename: 'chef-02.jpg',  theme: 'Chef Specials', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'chef-03',  filename: 'chef-03.jpg',  theme: 'Chef Specials', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'chef-04',  filename: 'chef-04.jpg',  theme: 'Chef Specials', widthPx: IMG_W, heightPx: IMG_H },
  // Behind the Scenes — 4 images
  { id: 'bts-01',   filename: 'bts-01.jpg',   theme: 'Behind the Scenes', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'bts-02',   filename: 'bts-02.jpg',   theme: 'Behind the Scenes', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'bts-03',   filename: 'bts-03.jpg',   theme: 'Behind the Scenes', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'bts-04',   filename: 'bts-04.jpg',   theme: 'Behind the Scenes', widthPx: IMG_W, heightPx: IMG_H },
  // Customer Stories — 4 images
  { id: 'cust-01',  filename: 'cust-01.jpg',  theme: 'Customer Stories', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'cust-02',  filename: 'cust-02.jpg',  theme: 'Customer Stories', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'cust-03',  filename: 'cust-03.jpg',  theme: 'Customer Stories', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'cust-04',  filename: 'cust-04.jpg',  theme: 'Customer Stories', widthPx: IMG_W, heightPx: IMG_H },
  // Offers — 4 images
  { id: 'offer-01', filename: 'offer-01.jpg', theme: 'Offers', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'offer-02', filename: 'offer-02.jpg', theme: 'Offers', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'offer-03', filename: 'offer-03.jpg', theme: 'Offers', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'offer-04', filename: 'offer-04.jpg', theme: 'Offers', widthPx: IMG_W, heightPx: IMG_H },
  // default — 3 images
  { id: 'default',    filename: 'default.jpg',    theme: 'default', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'default-02', filename: 'default-02.jpg', theme: 'default', widthPx: IMG_W, heightPx: IMG_H },
  { id: 'default-03', filename: 'default-03.jpg', theme: 'default', widthPx: IMG_W, heightPx: IMG_H },
];

// Pre-defined carousel sets (3 images each) — good variety across themes
export const CAROUSEL_SETS: CarouselSet[] = [
  { theme: 'Food & Menu',       filenames: ['food-01.jpg',  'food-02.jpg',  'food-03.jpg'],  widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Food & Menu',       filenames: ['food-03.jpg',  'food-04.jpg',  'food-05.jpg'],  widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Chef Specials',     filenames: ['chef-01.jpg',  'chef-02.jpg',  'chef-03.jpg'],  widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Chef Specials',     filenames: ['chef-02.jpg',  'chef-03.jpg',  'chef-04.jpg'],  widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Behind the Scenes', filenames: ['bts-01.jpg',   'bts-02.jpg',   'bts-03.jpg'],   widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Behind the Scenes', filenames: ['bts-02.jpg',   'bts-03.jpg',   'bts-04.jpg'],   widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Offers',            filenames: ['offer-01.jpg', 'offer-02.jpg', 'offer-03.jpg'], widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Offers',            filenames: ['offer-02.jpg', 'offer-03.jpg', 'offer-04.jpg'], widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'Customer Stories',  filenames: ['cust-01.jpg',  'cust-02.jpg',  'cust-03.jpg'],  widthPx: IMG_W, heightPx: IMG_H },
  { theme: 'default',           filenames: ['default.jpg',  'food-01.jpg',  'offer-01.jpg'], widthPx: IMG_W, heightPx: IMG_H },
];

// Vertical video placeholder size (9:16 reel/story). [SAMPLE]
const VID_W = 1080;
const VID_H = 1920;

// 6 themed placeholder videos with matching thumbnails
export const VIDEO_ASSETS: VideoAsset[] = [
  { id: 'food-vid-01', videoFilename: 'food-video-01.mp4', thumbnailFilename: 'food-video-01-thumb.jpg', theme: 'Food & Menu',       widthPx: VID_W, heightPx: VID_H, durationSeconds: 15 },
  { id: 'food-vid-02', videoFilename: 'food-video-02.mp4', thumbnailFilename: 'food-video-02-thumb.jpg', theme: 'Food & Menu',       widthPx: VID_W, heightPx: VID_H, durationSeconds: 20 },
  { id: 'chef-vid-01', videoFilename: 'chef-video-01.mp4', thumbnailFilename: 'chef-video-01-thumb.jpg', theme: 'Chef Specials',     widthPx: VID_W, heightPx: VID_H, durationSeconds: 18 },
  { id: 'chef-vid-02', videoFilename: 'chef-video-02.mp4', thumbnailFilename: 'chef-video-02-thumb.jpg', theme: 'Chef Specials',     widthPx: VID_W, heightPx: VID_H, durationSeconds: 22 },
  { id: 'bts-vid-01',  videoFilename: 'bts-video-01.mp4',  thumbnailFilename: 'bts-video-01-thumb.jpg',  theme: 'Behind the Scenes', widthPx: VID_W, heightPx: VID_H, durationSeconds: 25 },
  { id: 'default-vid', videoFilename: 'default-video.mp4', thumbnailFilename: 'default-video-thumb.jpg', theme: 'default',           widthPx: VID_W, heightPx: VID_H, durationSeconds: 15 },
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
