import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildVisionPrompt,
  requestVisionWithFailover
} from "./vision-request.mjs";

function createConfig() {
  return {
    cloudEgressEnabled: true,
    providers: [
      {
        lane: "ai",
        role: "primary",
        source: "canonical",
        kind: "openai_compatible",
        baseUrl: "https://primary.example.com/v1",
        apiKey: "primary-key",
        textModel: "gpt-5",
        visionModel: "gpt-5",
        textSurface: "chat_completions",
        visionSurface: "chat_completions"
      },
      {
        lane: "ai",
        role: "fallback_1",
        source: "canonical",
        kind: "openai_compatible",
        baseUrl: "https://fallback.example.com/v1",
        apiKey: "fallback-key",
        textModel: "gpt-5",
        visionModel: "gpt-5",
        textSurface: "chat_completions",
        visionSurface: "chat_completions"
      }
    ]
  };
}

function writeSyntheticImage() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-vision-test-"));
  const imagePath = path.join(tempDir, "synthetic.png");
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  writeFileSync(imagePath, Buffer.from(pngBase64, "base64"));
  return { tempDir, imagePath };
}

function validTrackResult() {
  return {
    schemaVersion: "1.0.0",
    kind: "track-result",
    trackResultId: "track-a.synthetic-vision-smoke",
    evidenceBundleRef: "bundle.synthetic-vision-smoke",
    trackType: "vlm_direct",
    candidateSourceType: "generated",
    answerCandidate: "synthetic image observed",
    confidence: 0.62,
    visualDetailMode: "high",
    visibleEvidenceSummary: "Synthetic one-pixel image was processed by the vision gateway.",
    evidenceRefs: ["crop.synthetic-vision-smoke"],
    conflictRefs: [],
    missingEvidenceRefs: [],
    validatorFindings: [],
    risk: {
      level: "medium",
      reviewRequired: true,
      reasons: ["synthetic_probe_only"]
    },
    generatedAt: "2026-07-08T00:00:00.000Z"
  };
}

test("vision failover retries a primary gateway failure and validates fallback TrackResult", async () => {
  const { tempDir, imagePath } = writeSyntheticImage();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).startsWith("https://primary.example.com")) {
      return new Response(JSON.stringify({ error: "temporary upstream failure" }), { status: 502 });
    }

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(validTrackResult())
          }
        }
      ]
    }), { status: 200 });
  };

  try {
    const result = await requestVisionWithFailover(createConfig(), {
      allowCloudEgress: true,
      imagePath,
      prompt: buildVisionPrompt({
        subjectPack: "math-answer",
        evidenceBundleRef: "bundle.synthetic-vision-smoke",
        trackResultId: "track-a.synthetic-vision-smoke"
      }),
      evidenceBundleRef: "bundle.synthetic-vision-smoke",
      trackResultId: "track-a.synthetic-vision-smoke",
      visualDetailMode: "high",
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "fallback_1");
    assert.equal(result.trackResult.trackType, "vlm_direct");
    assert.equal(result.trackResult.evidenceBundleRef, "bundle.synthetic-vision-smoke");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].retryable, true);
    assert.match(calls[1].body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(calls[1].body.response_format.type, "json_schema");
    assert.equal(calls[1].body.response_format.json_schema.name, "track_result");
    assert.equal(calls[1].body.response_format.json_schema.schema.$schema, undefined);
    assert.equal(calls[1].body.response_format.json_schema.schema.$id, undefined);
    assert.equal(calls[1].body.response_format.json_schema.schema.compatibility, undefined);
    assert.deepEqual(result.schemaErrors, []);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("vision failover stops on non-retryable provider errors", async () => {
  const { tempDir, imagePath } = writeSyntheticImage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "bad request" }), { status: 400 });

  try {
    const result = await requestVisionWithFailover(createConfig(), {
      allowCloudEgress: true,
      imagePath,
      prompt: buildVisionPrompt({
        subjectPack: "math-answer",
        evidenceBundleRef: "bundle.synthetic-vision-smoke",
        trackResultId: "track-a.synthetic-vision-smoke"
      }),
      evidenceBundleRef: "bundle.synthetic-vision-smoke",
      trackResultId: "track-a.synthetic-vision-smoke",
      visualDetailMode: "high",
      timeoutMs: 1000
    });

    assert.equal(result.ok, false);
    assert.equal(result.provider, "primary");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].retryable, false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("responses vision surface sends input_image and json_schema format", async () => {
  const { tempDir, imagePath } = writeSyntheticImage();
  const config = createConfig();
  config.providers = [
    {
      ...config.providers[0],
      visionSurface: "responses"
    }
  ];
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: JSON.stringify(validTrackResult()) }), { status: 200 });
  };

  try {
    const result = await requestVisionWithFailover(config, {
      allowCloudEgress: true,
      imagePath,
      prompt: buildVisionPrompt({
        subjectPack: "math-answer",
        evidenceBundleRef: "bundle.synthetic-vision-smoke",
        trackResultId: "track-a.synthetic-vision-smoke"
      }),
      evidenceBundleRef: "bundle.synthetic-vision-smoke",
      trackResultId: "track-a.synthetic-vision-smoke",
      visualDetailMode: "high",
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(requestBody.input[0].content[1].type, "input_image");
    assert.equal(requestBody.text.format.type, "json_schema");
    assert.equal(requestBody.text.format.name, "track_result");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("vision request can target fallback providers directly", async () => {
  const { tempDir, imagePath } = writeSyntheticImage();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(validTrackResult())
          }
        }
      ]
    }), { status: 200 });
  };

  try {
    const result = await requestVisionWithFailover(createConfig(), {
      provider: "fallback",
      allowCloudEgress: true,
      imagePath,
      prompt: buildVisionPrompt({
        subjectPack: "math-answer",
        evidenceBundleRef: "bundle.synthetic-vision-smoke",
        trackResultId: "track-a.synthetic-vision-smoke"
      }),
      evidenceBundleRef: "bundle.synthetic-vision-smoke",
      trackResultId: "track-a.synthetic-vision-smoke",
      visualDetailMode: "high",
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "fallback_1");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/fallback\.example\.com/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
