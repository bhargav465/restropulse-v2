# RestroPulse · Replicate Image Generator

A small Next.js (App Router + TypeScript) web app that runs **any** Replicate
image model from a prompt/context and shows the generated images.

## Features

- Enter any Replicate model identifier — `owner/name` or pinned
  `owner/name:version`.
- Quick-pick chips for popular models (FLUX, SDXL, Recraft).
- A prompt/context box (sent as the model's `prompt` field).
- **Prompt builder** — fill in restaurant-context fields (dish, cuisine, vibe,
  setting, lighting, details) and it composes a strong prompt for you.
- **Image-to-image / editing** — upload a source image and send it to a model
  that accepts an image input. The input field name is configurable
  (`input_image`, `image`, …) since it varies by model. The app warns you if
  you attach an image to a text-to-image-only model (which would ignore it).
- An optional **Extra input (JSON)** box for model-specific options like
  `aspect_ratio`, `num_outputs`, `seed`, or `prompt_strength`.
- Renders all returned images, each with a one-click **Download** button, an
  "open ↗" link, and a raw-output viewer for unusual models.
- Robust output parsing — handles models that return a single URL, an array,
  `FileOutput` objects, or nested shapes.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your Replicate API token. Copy the example and paste your token:

   ```bash
   cp .env.example .env.local
   # then edit .env.local and set REPLICATE_API_TOKEN=r8_...
   ```

   Get a token at <https://replicate.com/account/api-tokens>.
   `.env.local` is git-ignored, so your token is never committed.

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>.

## How it works

- `app/page.tsx` — the form UI (client component). It POSTs the model, prompt,
  and any extra JSON input to the API route.
- `app/api/generate/route.ts` — a server route that calls the Replicate API
  with your token (kept server-side, never exposed to the browser) via the
  official [`replicate`](https://www.npmjs.com/package/replicate) client, then
  normalizes the output into a list of image URLs.

The model `input` sent to Replicate is `{ prompt, ...extraInput }`. Different
models expect different fields — check a model's page on Replicate (its "API"
tab) for its exact input schema, and put anything beyond `prompt` into the
Extra input box.

## Examples

- **Model:** `black-forest-labs/flux-schnell`
  **Prompt:** `A cozy modern restaurant interior at golden hour, warm lighting`

- **Model:** `stability-ai/sdxl`
  **Prompt:** `Plated gourmet pasta, top-down food photography`
  **Extra input:** `{ "width": 1024, "height": 1024, "num_outputs": 2 }`

- **Editing an existing photo** — **Model:** `black-forest-labs/flux-kontext-pro`
  **Source image:** upload your photo · **Image input field:** `input_image`
  **Prompt:** `Make the lighting warm golden hour and add fresh basil garnish`

  > Text-to-image models (e.g. `flux-schnell`) have **no** image input — to
  > transform an existing image you must use an editing model like FLUX
  > Kontext. Pure text-to-image models ignore any uploaded image.

## Notes

- Image generation can take from a few seconds to a couple of minutes. The API
  route allows up to 300s.
- Never commit your real token. Only `.env.example` (a placeholder) is tracked.
