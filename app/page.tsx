"use client";

import { useRef, useState } from "react";

type GenerateResponse = {
  model: string;
  input: Record<string, unknown>;
  images: string[];
  raw: unknown;
  error?: string;
};

// A few popular text-to-image / image-to-image models to get going quickly.
const PRESETS: { label: string; model: string }[] = [
  { label: "FLUX schnell (fast)", model: "black-forest-labs/flux-schnell" },
  { label: "FLUX 1.1 pro", model: "black-forest-labs/flux-1.1-pro" },
  { label: "FLUX dev img2img", model: "black-forest-labs/flux-dev" },
  { label: "SDXL", model: "stability-ai/sdxl" },
  { label: "Recraft v3", model: "recraft-ai/recraft-v3" },
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
                onClick={() => setModel(p.model)}
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
                Most models use <code>image</code>; some use{" "}
                <code>input_image</code> or <code>image_prompt</code> — check the
                model&apos;s API tab.
              </div>
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
