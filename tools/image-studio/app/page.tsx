"use client";

import { useRef, useState } from "react";

type GenerateResponse = {
  model: string;
  input: Record<string, unknown>;
  images: string[];
  raw: unknown;
  error?: string;
};

// Popular models. `img2img` marks models that accept a source image; `imageField`
// is the input field that image should be sent as (it varies by model).
type Preset = {
  label: string;
  model: string;
  img2img: boolean;
  imageField?: string;
};

const PRESETS: Preset[] = [
  { label: "FLUX schnell · text→image", model: "black-forest-labs/flux-schnell", img2img: false },
  { label: "FLUX Kontext pro · edit image", model: "black-forest-labs/flux-kontext-pro", img2img: true, imageField: "input_image" },
  { label: "FLUX Kontext max · edit image", model: "black-forest-labs/flux-kontext-max", img2img: true, imageField: "input_image" },
  { label: "FLUX dev · img2img", model: "black-forest-labs/flux-dev", img2img: true, imageField: "image" },
  { label: "SDXL · img2img", model: "stability-ai/sdxl", img2img: true, imageField: "image" },
  { label: "Recraft v3 · text→image", model: "recraft-ai/recraft-v3", img2img: false },
];

// One-click recipes that pre-fill model + image field + a strong instruction
// prompt + sensible extra input for common restaurant tasks.
type Recipe = {
  key: string;
  emoji: string;
  label: string;
  desc: string;
  needsImage: boolean;
  model: string;
  imageField?: string;
  prompt: string;
  extra?: string;
};

const RECIPES: Recipe[] = [
  {
    key: "pro-dish",
    emoji: "🍽️",
    label: "Make my dish photo look pro",
    desc: "Edits your uploaded dish photo into clean, appetizing food photography.",
    needsImage: true,
    model: "black-forest-labs/flux-kontext-pro",
    imageField: "input_image",
    prompt:
      "Make this dish look like professional food photography: appetizing, clean plating, soft natural window light, shallow depth of field, fresh garnish, vibrant but natural colors, crisp high detail. Keep the same dish and composition.",
  },
  {
    key: "white-bg",
    emoji: "🛍️",
    label: "Clean white-background product shot",
    desc: "Puts your dish/product on a seamless white studio background.",
    needsImage: true,
    model: "black-forest-labs/flux-kontext-pro",
    imageField: "input_image",
    prompt:
      "Place this dish on a clean seamless white studio background with soft, even lighting and a subtle natural shadow, e-commerce product photography style. Keep the dish exactly as it is.",
  },
  {
    key: "cozy-interior",
    emoji: "🏮",
    label: "Restyle my restaurant interior",
    desc: "Edits an interior photo to feel warm, cozy and inviting.",
    needsImage: true,
    model: "black-forest-labs/flux-kontext-pro",
    imageField: "input_image",
    prompt:
      "Restyle this restaurant interior to look warm, cozy and inviting: golden-hour lighting, soft ambient glow, tasteful plants and decor, modern yet homely. Keep the existing layout and structure.",
  },
  {
    key: "menu-hero",
    emoji: "📸",
    label: "Menu hero image (from text)",
    desc: "Generates a fresh hero photo from a description — no source image needed. Edit the dish name in the prompt.",
    needsImage: false,
    model: "black-forest-labs/flux-schnell",
    prompt:
      "A mouth-watering gourmet dish, professional food photography, top-down on a rustic wooden table, soft natural window light, fresh ingredients scattered around, high detail, appetizing, 35mm",
    extra: '{ "aspect_ratio": "4:5" }',
  },
  {
    key: "social-square",
    emoji: "📱",
    label: "Social post (square, 2 options)",
    desc: "Generates two square images for social media from a description.",
    needsImage: false,
    model: "black-forest-labs/flux-schnell",
    prompt:
      "A vibrant, mouth-watering dish styled for social media, professional food photography, soft natural light, colorful fresh ingredients, high detail, appetizing",
    extra: '{ "aspect_ratio": "1:1", "num_outputs": 2 }',
  },
];

const MAX_IMAGE_MB = 6;

// Compose a strong image prompt from a few restaurant-context fields.
function buildPrompt(fields: {
  subject: string;
  cuisine: string;
  vibe: string;
  setting: string;
  lighting: string;
  details: string;
}): string {
  const parts: string[] = [];
  if (fields.subject.trim()) parts.push(fields.subject.trim());
  if (fields.cuisine.trim()) parts.push(`${fields.cuisine.trim()} cuisine`);
  if (fields.vibe.trim()) parts.push(`${fields.vibe.trim()} vibe`);
  if (fields.setting.trim()) parts.push(fields.setting.trim());
  if (fields.lighting.trim()) parts.push(`${fields.lighting.trim()} lighting`);
  if (fields.details.trim()) parts.push(fields.details.trim());
  if (parts.length === 0) return "";
  // A photographic finish that works well for food/restaurant imagery.
  parts.push("high detail, professional food photography, appetizing, 35mm");
  return parts.join(", ");
}

export default function Home() {
  const [model, setModel] = useState("black-forest-labs/flux-schnell");
  const [prompt, setPrompt] = useState("");
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  // Image-to-image / editing state.
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [imageField, setImageField] = useState("image");
  const fileRef = useRef<HTMLInputElement>(null);

  // Prompt-builder state.
  const [showBuilder, setShowBuilder] = useState(false);
  const [b, setB] = useState({
    subject: "",
    cuisine: "",
    vibe: "",
    setting: "",
    lighting: "",
    details: "",
  });

  // Track which images are downloading, by URL.
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  // If the chosen model is a known text-to-image-only model, a source image
  // will be ignored — warn the user so they switch to an image-editing model.
  const matchedPreset = PRESETS.find((p) => p.model === model.trim());
  const imageWillBeIgnored =
    !!imageDataUrl && !!matchedPreset && !matchedPreset.img2img;

  function onPickImage(file: File | null) {
    setError(null);
    if (!file) {
      setImageDataUrl(null);
      setImageName("");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — please use one under ${MAX_IMAGE_MB} MB.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
      setImageName(file.name);
    };
    reader.onerror = () => setError("Could not read that image file.");
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setImageDataUrl(null);
    setImageName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function applyRecipe(r: Recipe) {
    setError(null);
    setModel(r.model);
    setPrompt(r.prompt);
    setExtra(r.extra ?? "");
    if (r.imageField) setImageField(r.imageField);
    if (r.needsImage && !imageDataUrl) {
      setNotice(
        `“${r.label}” edits a photo — upload your source image below, then Generate.`
      );
    } else if (!r.needsImage) {
      setNotice(
        `“${r.label}” generates from text — tweak the prompt (e.g. the dish), then Generate.`
      );
    } else {
      setNotice(`“${r.label}” is ready — adjust the prompt if needed, then Generate.`);
    }
  }

  function applyBuiltPrompt() {
    const built = buildPrompt(b);
    if (!built) {
      setError("Fill in at least one field to build a prompt.");
      return;
    }
    setError(null);
    setPrompt(built);
    setShowBuilder(false);
  }

  async function downloadImage(url: string, index: number) {
    setDownloading((d) => ({ ...d, [url]: true }));
    try {
      // Fetch as a blob so the browser saves the file instead of navigating.
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] || "png").split(";")[0];
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `restropulse-${index + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Cross-origin or network issue — fall back to opening in a new tab.
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading((d) => ({ ...d, [url]: false }));
    }
  }

  async function onGenerate() {
    setError(null);
    setNotice(null);
    setResult(null);

    let extraInput: Record<string, unknown> | undefined;
    if (extra.trim()) {
      try {
        extraInput = JSON.parse(extra);
        if (typeof extraInput !== "object" || Array.isArray(extraInput)) {
          throw new Error("must be a JSON object");
        }
      } catch (e) {
        setError(
          `Extra input must be a valid JSON object, e.g. {"aspect_ratio": "16:9"}.\n${
            e instanceof Error ? e.message : ""
          }`
        );
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          extraInput,
          imageDataUrl: imageDataUrl ?? undefined,
          imageFieldName: imageField,
        }),
      });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status}).`);
      } else {
        setResult(data);
        if (data.images.length === 0) {
          setError(
            "The model ran but no image URL was found in its output. Check the raw output below."
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <div className="header">
        <h1>RestroPulse · Replicate Image Generator</h1>
        <p>
          Enter any Replicate model and a prompt/context — optionally with a
          source image — then generate.
        </p>
      </div>

      <div className="panel recipes">
        <label>Quick recipes</label>
        <div className="hint">
          One click pre-fills the model, prompt, and settings for a common task.
        </div>
        <div className="recipeGrid">
          {RECIPES.map((r) => (
            <button
              key={r.key}
              type="button"
              className="recipe"
              onClick={() => applyRecipe(r)}
            >
              <span className="recipeTitle">
                {r.emoji} {r.label}
              </span>
              <span className="recipeDesc">{r.desc}</span>
              <span className={`recipeTag ${r.needsImage ? "edit" : "text"}`}>
                {r.needsImage ? "needs a source image" : "text → image"}
              </span>
            </button>
          ))}
        </div>
        {notice && <div className="notice">{notice}</div>}
      </div>

      <div className="panel grid">
        <div>
          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            value={model}
            placeholder="owner/name or owner/name:version"
            onChange={(e) => setModel(e.target.value)}
          />
          <div className="hint">
            e.g. <code>black-forest-labs/flux-schnell</code>. Pin a version with{" "}
            <code>owner/name:version</code>.
          </div>
          <div className="chips">
            {PRESETS.map((p) => (
              <span
                key={p.model}
                className="chip"
                onClick={() => {
                  setModel(p.model);
                  if (p.imageField) setImageField(p.imageField);
                }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="labelRow">
            <label htmlFor="prompt">Prompt / context</label>
            <button
              type="button"
              className="link"
              onClick={() => setShowBuilder((s) => !s)}
            >
              {showBuilder ? "Hide builder" : "✨ Build from context"}
            </button>
          </div>
          <textarea
            id="prompt"
            value={prompt}
            placeholder="A cozy modern restaurant interior at golden hour, warm lighting, plants, photorealistic"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="hint">
            Sent as the model&apos;s <code>prompt</code> field.
          </div>

          {showBuilder && (
            <div className="builder">
              <div className="builderGrid">
                <div>
                  <label>Subject / dish</label>
                  <input
                    type="text"
                    value={b.subject}
                    placeholder="Margherita pizza"
                    onChange={(e) => setB({ ...b, subject: e.target.value })}
                  />
                </div>
                <div>
                  <label>Cuisine</label>
                  <input
                    type="text"
                    value={b.cuisine}
                    placeholder="Italian"
                    onChange={(e) => setB({ ...b, cuisine: e.target.value })}
                  />
                </div>
                <div>
                  <label>Vibe / style</label>
                  <input
                    type="text"
                    value={b.vibe}
                    placeholder="rustic, cozy"
                    onChange={(e) => setB({ ...b, vibe: e.target.value })}
                  />
                </div>
                <div>
                  <label>Setting</label>
                  <input
                    type="text"
                    value={b.setting}
                    placeholder="on a wooden table near a window"
                    onChange={(e) => setB({ ...b, setting: e.target.value })}
                  />
                </div>
                <div>
                  <label>Lighting</label>
                  <input
                    type="text"
                    value={b.lighting}
                    placeholder="warm golden hour"
                    onChange={(e) => setB({ ...b, lighting: e.target.value })}
                  />
                </div>
                <div>
                  <label>Extra details</label>
                  <input
                    type="text"
                    value={b.details}
                    placeholder="steam rising, fresh basil"
                    onChange={(e) => setB({ ...b, details: e.target.value })}
                  />
                </div>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="primary small"
                  onClick={applyBuiltPrompt}
                >
                  Use this prompt
                </button>
                <span className="hint preview">{buildPrompt(b)}</span>
              </div>
            </div>
          )}
        </div>

        <div>
          <label>Source image (optional · for image-to-image / editing)</label>
          <div className="row imgRow">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
            />
            {imageDataUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="thumb" src={imageDataUrl} alt="source preview" />
                <button type="button" className="link" onClick={clearImage}>
                  remove
                </button>
              </>
            )}
          </div>
          {imageDataUrl && (
            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ flex: "0 0 220px" }}>
                <label>Image input field name</label>
                <input
                  type="text"
                  value={imageField}
                  onChange={(e) => setImageField(e.target.value)}
                />
              </div>
              <div className="hint" style={{ alignSelf: "flex-end" }}>
                {imageName && <>Using <code>{imageName}</code>. </>}
                Most editors use <code>input_image</code> (FLUX Kontext) or{" "}
                <code>image</code> (SDXL/FLUX dev) — check the model&apos;s API
                tab.
              </div>
            </div>
          )}
          {imageWillBeIgnored && (
            <div className="warn">
              ⚠️ <code>{model.trim()}</code> is a <strong>text-to-image</strong>{" "}
              model — it has no image input, so your source image will be{" "}
              <strong>ignored</strong> and the result comes only from the prompt.
              To edit/transform your image, pick an editing model like{" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setModel("black-forest-labs/flux-kontext-pro");
                  setImageField("input_image");
                }}
              >
                FLUX Kontext pro
              </button>{" "}
              and describe the change in the prompt.
            </div>
          )}
        </div>

        <div>
          <label htmlFor="extra">Extra input (optional JSON)</label>
          <textarea
            id="extra"
            className="mono"
            value={extra}
            placeholder={'{ "aspect_ratio": "16:9", "num_outputs": 2 }'}
            onChange={(e) => setExtra(e.target.value)}
          />
          <div className="hint">
            Merged into the model input — model-specific options like{" "}
            <code>aspect_ratio</code>, <code>num_outputs</code>,{" "}
            <code>seed</code>, <code>prompt_strength</code>.
          </div>
        </div>

        <div className="row">
          <button
            className="primary"
            onClick={onGenerate}
            disabled={loading || !model.trim()}
          >
            {loading && <span className="spinner" />}
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>

        {error && <div className="error">{error}</div>}
      </div>

      {result && result.images.length > 0 && (
        <section className="results">
          <h2>
            {result.images.length} image
            {result.images.length > 1 ? "s" : ""}
          </h2>
          <div className="imgGrid">
            {result.images.map((url, i) => (
              <div className="imgCard" key={url + i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Generated ${i + 1}`} />
                <div className="meta">
                  <span>#{i + 1}</span>
                  <span className="metaActions">
                    <button
                      type="button"
                      className="link"
                      disabled={downloading[url]}
                      onClick={() => downloadImage(url, i)}
                    >
                      {downloading[url] ? "saving…" : "⬇ download"}
                    </button>
                    <a href={url} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {result && (
        <details className="raw" open>
          <summary>Input sent to the model</summary>
          <pre>{JSON.stringify(redactInput(result.input), null, 2)}</pre>
        </details>
      )}

      {result && (
        <details className="raw">
          <summary>Raw model output</summary>
          <pre>{JSON.stringify(result.raw, null, 2)}</pre>
        </details>
      )}
    </main>
  );
}

// Long base64 image data URLs make the input panel unreadable — shorten them.
function redactInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.startsWith("data:")) {
      out[k] = `${v.slice(0, 40)}… (${v.length} chars, source image)`;
    } else {
      out[k] = v;
    }
  }
  return out;
}
