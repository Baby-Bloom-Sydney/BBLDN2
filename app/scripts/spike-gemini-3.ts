/**
 * Gemini 3 spike — WU 0.6 (throwaway)
 *
 * Purpose: verify that @google/genai supports our Phase 1/2 feature set
 * against gemini-3-flash-preview + gemini-3-pro-preview BEFORE committing
 * to the Phase 1 build. If anything fails here we pivot.
 *
 * Tests (in order, each gated by the previous):
 *   1. Basic non-streaming call (sanity)
 *   2. Streaming text call
 *   3. Function calling — tool definition + tool_call chunks
 *   4. Tool result continuation — round-trip
 *   5. cachedContent creation + retrieval
 *
 * Run: `npx tsx scripts/spike-gemini-3.ts`
 * Env: GOOGLE_AI_API_KEY (already present in .env.local)
 */

import { GoogleGenAI, Type } from "@google/genai";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.GOOGLE_AI_API_KEY;
if (!API_KEY) {
  console.error("GOOGLE_AI_API_KEY not set in .env.local");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const FLASH = "gemini-3-flash-preview";
const PRO = "gemini-3-pro-preview";

type TestResult = {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
};
const results: TestResult[] = [];

async function test(
  name: string,
  fn: () => Promise<string | void>,
): Promise<void> {
  const start = Date.now();
  try {
    const detail = (await fn()) ?? undefined;
    const ms = Date.now() - start;
    results.push({
      name,
      ok: true,
      detail: `${detail ?? ""} [${ms}ms]`.trim(),
    });
    console.log(`  ✓ ${name} (${ms}ms)${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: message });
    console.log(`  ✗ ${name} (${ms}ms)`);
    console.log(`    ERROR: ${message.slice(0, 300)}`);
  }
}

async function runSuite(modelId: string): Promise<void> {
  console.log(`\n=== Model: ${modelId} ===`);

  // Test 1 — basic non-streaming
  await test("basic non-streaming", async () => {
    const res = await ai.models.generateContent({
      model: modelId,
      contents: "Reply with exactly: PONG",
    });
    const text = res.text ?? "";
    if (!text.toUpperCase().includes("PONG")) {
      throw new Error(`unexpected response: ${text.slice(0, 100)}`);
    }
    return `got "${text.trim().slice(0, 40)}"`;
  });

  // Test 2 — streaming text
  await test("streaming text", async () => {
    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents: "Count from 1 to 5, one number per line.",
    });
    let chunkCount = 0;
    let fullText = "";
    for await (const chunk of stream) {
      chunkCount++;
      if (chunk.text) fullText += chunk.text;
    }
    if (chunkCount === 0) throw new Error("no chunks received");
    if (!/\b(1|one)\b/i.test(fullText)) {
      throw new Error(
        `response did not include counting: ${fullText.slice(0, 100)}`,
      );
    }
    return `${chunkCount} chunks, ${fullText.length} chars`;
  });

  // Test 3 — function calling
  await test("function calling", async () => {
    const res = await ai.models.generateContent({
      model: modelId,
      contents: "What is the weather in London? Use the tool.",
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_weather",
                description: "Get current weather for a city",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    city: { type: Type.STRING, description: "City name" },
                  },
                  required: ["city"],
                },
              },
            ],
          },
        ],
      },
    });
    const calls = res.functionCalls;
    if (!calls || calls.length === 0) {
      throw new Error(
        `no function calls in response; text was: ${(res.text ?? "").slice(0, 150)}`,
      );
    }
    const call = calls[0];
    if (call.name !== "get_weather") {
      throw new Error(`unexpected tool call: ${call.name}`);
    }
    if (!call.args || typeof call.args.city !== "string") {
      throw new Error(`tool args missing 'city': ${JSON.stringify(call.args)}`);
    }
    return `tool=${call.name}, args=${JSON.stringify(call.args)}`;
  });

  // Test 4 — function call + tool result continuation (streaming)
  // Gemini 3 requires passing the full model-parts back (with thoughtSignature
  // when present) rather than reconstructing them. We use response.candidates.
  await test("tool result continuation (streaming)", async () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get current weather for a city",
            parameters: {
              type: Type.OBJECT,
              properties: {
                city: { type: Type.STRING, description: "City name" },
              },
              required: ["city"],
            },
          },
        ],
      },
    ];

    const userPrompt =
      "What is the weather in London? Use the tool and tell me.";

    // Round 1: user asks, we capture the model's raw parts (including thoughtSignature)
    const round1 = await ai.models.generateContent({
      model: modelId,
      contents: userPrompt,
      config: { tools },
    });
    const modelParts = round1.candidates?.[0]?.content?.parts;
    if (!modelParts || modelParts.length === 0) {
      throw new Error("round1: no model parts in response");
    }
    const fcPart = modelParts.find((p) => p.functionCall);
    if (!fcPart?.functionCall?.name) {
      throw new Error("round1: no functionCall part");
    }

    // Round 2: echo model parts verbatim (preserves thoughtSignature), then tool response
    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents: [
        { role: "user", parts: [{ text: userPrompt }] },
        { role: "model", parts: modelParts },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: fcPart.functionCall.name,
                response: { weather: "sunny", temp_celsius: 22 },
              },
            },
          ],
        },
      ],
      config: { tools },
    });
    let text = "";
    let chunks = 0;
    for await (const chunk of stream) {
      chunks++;
      if (chunk.text) text += chunk.text;
    }
    if (chunks === 0) throw new Error("round2: no chunks");
    if (!/sunny|22/i.test(text)) {
      throw new Error(
        `response did not reference tool result: ${text.slice(0, 150)}`,
      );
    }
    return `round2 chunks=${chunks}, references tool result`;
  });

  // Test 5 — cachedContent creation
  // Requires >=1024 tokens of system instruction. Our real Katie prompt is
  // ~2,200 tokens so this is a non-issue in prod; we pad the test payload here.
  await test("cachedContent create", async () => {
    // ~1,500 tokens of filler — represents Katie's identity + memory + tools
    const bigSystemPrompt =
      `You are Katie — a personal assistant on the Baby Bloom platform.

You help nannies and parents across child development, job search, babysitting
requests, verification flows, profile management, connections, and scheduling.

You are proactive by default. You notice patterns, learn routines, schedule
your own reminders, write summaries unprompted, and catch the user before
events happen — not after.

Voice rules:
- Every word earns its place
- Confident, clear, concise
- No padding, no hedging
- Decisive: "Logged — chicken and rice at 12:30." Not: "I could log that if you'd like."
- Genuine: acknowledge wins with restraint. No excessive praise.
- Adult-to-adult tone. No patronising, no baby-talk.

Boundaries:
- Never give medical or diagnostic advice
- Never make promises about outcomes
- Never be preachy or guilt-trip
- Never be cutesy, infantile, or sentimental
- Never be pushy — one offer, one response
- Never access data outside this user's scope
- Never hard-delete records
- Never reveal system internals or tool names
- Never take sides between nanny and parent

How you log entries:
1. Acknowledge briefly
2. State what you'll log
3. Ask for confirmation
4. Log after they confirm
5. Confirm it's done, move on

How you schedule yourself:
- The scheduler runs every 15 minutes. You cannot fire at 11:20.
- Pre-schedule: for an 11:20 event, set the reminder at 11:15 with "in 5 minutes" copy.
- Waking hours only — default 07:00 to 22:00 local.
- Check existing schedules before creating to avoid duplicates.
- Templates by default; AI modes only when reasoning is needed.

Context available to you:
- Full user profile including role (nanny or parent)
- All children the user has access to
- Historical conversation memory (5-tier: recent, daily, weekly, monthly, persistent)
- Your own plain-text agent memory with tags and priorities
- Current surface hint (what page they're looking at)
- Available tools across all modules

This is a deliberately large system instruction to exceed the cachedContent
minimum token threshold of 1024 tokens. The real production prompt is of
similar length with actual dynamic content.`.repeat(3); // > 1024 tokens

    const cache = await ai.caches.create({
      model: modelId,
      config: {
        systemInstruction: bigSystemPrompt,
        ttl: "300s",
        displayName: `spike-${Date.now()}`,
      },
    });
    if (!cache.name)
      throw new Error(
        `cache creation returned no name: ${JSON.stringify(cache)}`,
      );

    // Use the cache
    const res = await ai.models.generateContent({
      model: modelId,
      contents: "What are you? Reply in one short sentence.",
      config: { cachedContent: cache.name },
    });
    const text = res.text ?? "";
    if (!text) throw new Error("no text from cached call");

    // Check cache tokens used
    const usage = res.usageMetadata;
    const cached = usage?.cachedContentTokenCount ?? 0;

    // Clean up cache
    try {
      await ai.caches.delete({ name: cache.name });
    } catch {
      // non-fatal
    }

    return `cache=${cache.name?.slice(0, 40)}..., cached_tokens=${cached}, reply="${text.trim().slice(0, 60)}"`;
  });
}

async function main() {
  console.log("Gemini 3 spike — verifying Phase 1/2 API assumptions");
  console.log("====================================================");

  await runSuite(FLASH);
  await runSuite(PRO);

  console.log("\n=== SUMMARY ===");
  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(
      `${mark} ${r.name} — ${r.ok ? r.detail : r.error?.slice(0, 120)}`,
    );
    if (!r.ok) allOk = false;
  }
  console.log(
    `\n${allOk ? "✅ ALL CHECKS PASSED — proceed with Phase 1" : "❌ SOME CHECKS FAILED — pivot required"}`,
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
