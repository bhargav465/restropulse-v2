import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

// Image generation can take a while; give the route room to run.
export const maxDuration = 300;
export const runtime = "nodejs";

type GenerateBody = {
  /** Replicate model identifier, e.g. "black-forest-labs/flux-schnell" or "owner/name:version" */
  model?: string;
  /** The prompt / context to generate an image from. */
  prompt?: string;
  /** Optional extra input fields as a JSON object, merged into the model input. */
  extraInput?: Record<string, unknown>;
};

/**
 * Normalize whatever a model returns into a flat list of image URLs.
 * Replicate models return output in many shapes: a single URL string,
 * an array of URLs, or nested objects/arrays. We dig out anything that
 * looks like an image URL.
 */
function extractImageUrls(output: unknown): string[] {
  const urls: string[] = [];

  const visit = (value: unknown) => {
    if (value == null) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      // The replicate client may return FileOutput objects with a .url().
      const maybeUrl = (value as { url?: unknown }).url;
      if (typeof maybeUrl === "string" && /^https?:\/\//i.test(maybeUrl)) {
        urls.push(maybeUrl);
        return;
      }
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };

  visit(output);
  return Array.from(new Set(urls));
}

/** Split "owner/name:version" into the two parts the client expects. */
function parseModel(model: string): {
  ref: `${string}/${string}` | `${string}/${string}:${string}`;
} {
  const trimmed = model.trim();
  return { ref: trimmed as `${string}/${string}` };
}

export async function POST(req: NextRequest) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "REPLICATE_API_TOKEN is not set. Add it to .env.local and restart the dev server.",
      },
      { status: 500 }
    );
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const model = body.model?.trim();
  const prompt = body.prompt?.trim();

  if (!model) {
    return NextResponse.json(
      { error: "A model identifier is required (e.g. owner/name or owner/name:version)." },
      { status: 400 }
    );
  }
  if (!/^[^/\s]+\/[^/\s:]+(:[^\s]+)?$/.test(model)) {
    return NextResponse.json(
      {
        error:
          "Model must look like 'owner/name' or 'owner/name:version' (e.g. black-forest-labs/flux-schnell).",
      },
      { status: 400 }
    );
  }
  if (!prompt && !body.extraInput) {
    return NextResponse.json(
      { error: "Provide a prompt/context or extra input for the model." },
      { status: 400 }
    );
  }

  // useFileOutput: false makes replicate.run() return plain URL strings
  // instead of FileOutput stream objects, which is easier to render.
  const replicate = new Replicate({ auth: token, useFileOutput: false });

  // Most image models accept a `prompt` field. We merge any extra input the
  // user supplied so less conventional models can still be driven.
  const input: Record<string, unknown> = {
    ...(prompt ? { prompt } : {}),
    ...(body.extraInput ?? {}),
  };

  try {
    const { ref } = parseModel(model);
    const output = await replicate.run(ref, { input });
    const images = extractImageUrls(output);

    return NextResponse.json({
      model,
      input,
      images,
      // Include the raw output so unusual models are still inspectable.
      raw: output,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error calling Replicate.";
    // Surface common, actionable failures clearly.
    const status = /401|unauthorized|authentication/i.test(message)
      ? 401
      : /404|not found/i.test(message)
        ? 404
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
