import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";
import TOV_SYSTEM_PROMPT from "./tov.js";
import { updateTopicDraft } from "./db.js";

const CONTENT_TYPES = {
  expert:      { label: "Expert Take",    tov: "authoritative analysis with data" },
  educational: { label: "Educational",    tov: "teach a concept through a real example" },
  viral:       { label: "Viral / Trend",  tov: "ride the moment, fast take, sharp angle" },
  tools:       { label: "Tool Review",    tov: "I tested this so you can decide if it's worth it" },
};

export async function generateDraft(topic) {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const ct = CONTENT_TYPES[topic.content_type] || CONTENT_TYPES.expert;
  const niches = JSON.parse(topic.niches || "[]").join(", ");

  const userPrompt = `Write a LinkedIn post about this topic.

TOPIC: ${topic.title}
CONTENT TYPE: ${ct.label} — ${ct.tov}
NICHES: ${niches}
HOOK SUGGESTION: ${topic.hook}
POST DIRECTION: ${topic.post_idea}
SOURCE URL: ${topic.source_url}
SOURCE: ${topic.source_title}
FACT STATUS: ${topic.fact_checked ? "VERIFIED: " + topic.fact_notes : "NEEDS VERIFICATION: " + (topic.fact_notes || "fact-check the key claims")}

CRITICAL:
- Use web_search to fact-check specific numbers before including them
- If a claim can't be verified, flag it or remove it
- Frame as discoveries ("I found", "interesting that"), NEVER lectures
- No em dashes (—). No "What do you think?" at the end.
- Sources line at bottom
- English only
- Follow the Spicy Analyst ToV exactly`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1500,
    system: TOV_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    betas: ["web-search-2025-03-05"],
  });

  const draft = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  if (!draft) throw new Error("Empty response from Claude API");

  updateTopicDraft(topic.id, draft);
  return draft;
}
