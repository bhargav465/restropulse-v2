/**
 * Download Placeholder Assets
 *
 * One-time setup script. Downloads food-themed placeholder images and
 * short sample videos into the assets/ directory so the content-engine
 * can serve them locally.
 *
 * Usage: npm run download-assets
 *
 * Skips files that already exist so it is safe to re-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '../assets');
const IMAGES_DIR = path.join(ASSETS_DIR, 'images');
const VIDEOS_DIR = path.join(ASSETS_DIR, 'videos');

// ---------------------------------------------------------------------------
// Asset definitions
// ---------------------------------------------------------------------------

// Food-themed images from picsum.photos using stable seeds.
// picsum returns 302 redirects; fetch() follows them automatically.
const IMAGES = [
  // Food & Menu (5)
  { filename: 'food-01.jpg',  url: 'https://picsum.photos/seed/rp-food-01/800/800' },
  { filename: 'food-02.jpg',  url: 'https://picsum.photos/seed/rp-food-02/800/800' },
  { filename: 'food-03.jpg',  url: 'https://picsum.photos/seed/rp-food-03/800/800' },
  { filename: 'food-04.jpg',  url: 'https://picsum.photos/seed/rp-food-04/800/800' },
  { filename: 'food-05.jpg',  url: 'https://picsum.photos/seed/rp-food-05/800/800' },
  // Chef Specials (4)
  { filename: 'chef-01.jpg',  url: 'https://picsum.photos/seed/rp-chef-01/800/800' },
  { filename: 'chef-02.jpg',  url: 'https://picsum.photos/seed/rp-chef-02/800/800' },
  { filename: 'chef-03.jpg',  url: 'https://picsum.photos/seed/rp-chef-03/800/800' },
  { filename: 'chef-04.jpg',  url: 'https://picsum.photos/seed/rp-chef-04/800/800' },
  // Behind the Scenes (4)
  { filename: 'bts-01.jpg',   url: 'https://picsum.photos/seed/rp-bts-01/800/800' },
  { filename: 'bts-02.jpg',   url: 'https://picsum.photos/seed/rp-bts-02/800/800' },
  { filename: 'bts-03.jpg',   url: 'https://picsum.photos/seed/rp-bts-03/800/800' },
  { filename: 'bts-04.jpg',   url: 'https://picsum.photos/seed/rp-bts-04/800/800' },
  // Customer Stories (4)
  { filename: 'cust-01.jpg',  url: 'https://picsum.photos/seed/rp-cust-01/800/800' },
  { filename: 'cust-02.jpg',  url: 'https://picsum.photos/seed/rp-cust-02/800/800' },
  { filename: 'cust-03.jpg',  url: 'https://picsum.photos/seed/rp-cust-03/800/800' },
  { filename: 'cust-04.jpg',  url: 'https://picsum.photos/seed/rp-cust-04/800/800' },
  // Offers (4)
  { filename: 'offer-01.jpg', url: 'https://picsum.photos/seed/rp-offer-01/800/800' },
  { filename: 'offer-02.jpg', url: 'https://picsum.photos/seed/rp-offer-02/800/800' },
  { filename: 'offer-03.jpg', url: 'https://picsum.photos/seed/rp-offer-03/800/800' },
  { filename: 'offer-04.jpg', url: 'https://picsum.photos/seed/rp-offer-04/800/800' },
  // default (3)
  { filename: 'default.jpg',    url: 'https://picsum.photos/seed/rp-default/800/800' },
  { filename: 'default-02.jpg', url: 'https://picsum.photos/seed/rp-default-02/800/800' },
  { filename: 'default-03.jpg', url: 'https://picsum.photos/seed/rp-default-03/800/800' },
];

// Video thumbnail images — portrait crop (1080×1920) for story/reel thumbnails
const VIDEO_THUMBS = [
  { filename: 'food-video-01-thumb.jpg',  url: 'https://picsum.photos/seed/rp-vid-food-01/1080/1920' },
  { filename: 'food-video-02-thumb.jpg',  url: 'https://picsum.photos/seed/rp-vid-food-02/1080/1920' },
  { filename: 'chef-video-01-thumb.jpg',  url: 'https://picsum.photos/seed/rp-vid-chef-01/1080/1920' },
  { filename: 'chef-video-02-thumb.jpg',  url: 'https://picsum.photos/seed/rp-vid-chef-02/1080/1920' },
  { filename: 'bts-video-01-thumb.jpg',   url: 'https://picsum.photos/seed/rp-vid-bts-01/1080/1920' },
  { filename: 'default-video-thumb.jpg',  url: 'https://picsum.photos/seed/rp-vid-default/1080/1920' },
];

// Portrait placeholder videos generated locally by ffmpeg (1080×1920, 9:16, 30 s).
// Generated rather than downloaded to guarantee portrait dimensions and avoid
// external URL failures. ffmpeg creates solid-color H.264/AAC MP4s — minimal
// file size (~150 KB each), valid for Instagram REEL and STORY publishing.
const VIDEOS = [
  { filename: 'food-video-01.mp4',  color: '0xE8552B' },  // warm orange  – Food & Menu
  { filename: 'food-video-02.mp4',  color: '0xC0392B' },  // deep red      – Food & Menu
  { filename: 'chef-video-01.mp4',  color: '0x8E44AD' },  // purple        – Chef Specials
  { filename: 'chef-video-02.mp4',  color: '0x6C3483' },  // dark purple   – Chef Specials
  { filename: 'bts-video-01.mp4',   color: '0x1A5276' },  // dark blue     – Behind the Scenes
  { filename: 'default-video.mp4',  color: '0x2C3E50' },  // slate         – default
];

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

async function downloadFile(url, destPath, { optional = false } = {}) {
  const name = path.basename(destPath);

  if (fs.existsSync(destPath)) {
    console.log(`  ✓ ${name} (already exists, skipping)`);
    return true;
  }

  process.stdout.write(`  ↓ ${name} ...`);

  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    if (optional) {
      process.stdout.write(` skipped (${err.message})\n`);
      return false;
    }
    throw err;
  }

  if (!response.ok) {
    if (optional) {
      process.stdout.write(` skipped (HTTP ${response.status})\n`);
      return false;
    }
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.promises.writeFile(destPath, Buffer.from(buffer));

  const kb = Math.round(buffer.byteLength / 1024);
  process.stdout.write(` done (${kb} KB)\n`);
  return true;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Portrait video generator
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

/**
 * Generate a 1080×1920 portrait H.264/AAC MP4 using ffmpeg.
 * Creates a 30-second solid-color placeholder — valid for Instagram Reels and Stories.
 */
async function generatePortraitVideo(filename, color) {
  const destPath = path.join(VIDEOS_DIR, filename);

  if (fs.existsSync(destPath)) {
    console.log(`  ✓ ${filename} (already exists, skipping)`);
    return;
  }

  process.stdout.write(`  ⚙ ${filename} (generating) ...`);

  await execFileAsync('ffmpeg', [
    '-f', 'lavfi', '-i', `color=c=${color}:s=1080x1920:r=30`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35',
    '-c:a', 'aac', '-b:a', '64k',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    '-y', destPath,
  ]);

  const { size } = fs.statSync(destPath);
  process.stdout.write(` done (${Math.round(size / 1024)} KB)\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\nRestroPulse Content Engine — Download Placeholder Assets\n');

  // Create directories if they don't exist
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });

  // Images
  console.log('Images:');
  for (const asset of IMAGES) {
    await downloadFile(asset.url, path.join(IMAGES_DIR, asset.filename));
  }

  // Video thumbnails (stored alongside videos)
  console.log('\nVideo thumbnails:');
  for (const thumb of VIDEO_THUMBS) {
    await downloadFile(thumb.url, path.join(VIDEOS_DIR, thumb.filename));
  }

  // Videos — generated locally with ffmpeg (portrait 1080×1920, 30 s, H.264/AAC).
  console.log('\nVideos (portrait 1080×1920, generated with ffmpeg):');
  for (const video of VIDEOS) {
    await generatePortraitVideo(video.filename, video.color);
  }

  console.log('\nAll assets ready. You can now run: npm run dev\n');
}

main().catch((err) => {
  console.error('\nDownload failed:', err.message);
  process.exit(1);
});
