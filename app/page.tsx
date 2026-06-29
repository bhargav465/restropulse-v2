"use client";

import { useState } from "react";

type GenerateResponse = {
  model: string;
  input: Record<string, unknown>;
  images: string[];
  raw: unknown;
  error?: string;
};

// A few popular text-to-image models to get going quickly.
const PRESETS: { label: string; model: string }[] = [
  { label: "FLUX schnell (fast)", model: "black-forest-labs/flux-schnell" },
  { label: "FLUX 1.1 pro", model: "black-forest-labs/flux-1.1-pro" },
  { label: "SDXL", model: "stability-ai/sdxl" },
  { label: "Recraft v3", model: "recraft-ai/recraft-v3" },
];

export default function Home() {
  const [model, setModel] = useState("black-forest-labs/flux-schnell");
  const [prompt, setPrompt] = useState("");
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

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
        body: JSON.stringify({ model, prompt, extraInput }),
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
          Enter any Replicate model and a prompt/context, then generate images.
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
          <label htmlFor="prompt">Prompt / context</label>
          <textarea
            id="prompt"
            value={prompt}
            placeholder="A cozy modern restaurant interior at golden hour, warm lighting, plants, photorealistic"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="hint">
            Sent as the model&apos;s <code>prompt</code> field.
          </div>
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
            <code>seed</code>.
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
                {/* Plain img tag keeps any Replicate host working without
                    extra Next image config. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Generated ${i + 1}`} />
                <div className="meta">
                  <span>#{i + 1}</span>
                  <a href={url} target="_blank" rel="noreferrer">
                    open ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
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
