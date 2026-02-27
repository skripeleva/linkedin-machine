import RssParser from "rss-parser";
import config from "./config.js";
import { upsertTopic, insertScanLog } from "./db.js";
import { scoreRelevance, scoreEngagement, scoreFreshness, scoreVirality } from "./scorer.js";

const rssParser = new RssParser({ timeout: 10000 });

// ─── Helpers ────────────────────────────────────────────────────────────────

function matchKeywords(text) {
  const lower = text.toLowerCase();
  const matched = {};
  for (const [category, words] of Object.entries(config.keywords)) {
    if (words.some(w => lower.includes(w))) matched[category] = true;
  }
  return matched;
}

function classifyNiches(matchedCategories) {
  const niches = [];
  if (matchedCategories.ai)     niches.push("AI + Marketing");
  if (matchedCategories.crypto) niches.push("Crypto / Web3");
  if (matchedCategories.growth) niches.push("Growth Marketing");
  if (niches.length >= 2)       niches.push("GTM Strategy");
  return niches;
}

function classifyContentType(niches, matchedCategories) {
  if (matchedCategories.growth) return "expert";
  if (matchedCategories.crypto) return "viral";
  if (matchedCategories.ai)     return "tools";
  return "educational";
}

function buildScore(topic) {
  const niches = JSON.parse(topic.niches);
  const raw = JSON.parse(topic.raw_data);
  const score_r = scoreRelevance(topic.title, niches);
  const score_e = scoreEngagement(topic.source, raw);
  const score_f = scoreFreshness(topic.age_hours);
  const score_v = scoreVirality(topic.source, raw);
  return { score_r, score_e, score_f, score_v, score: score_r + score_e + score_f + score_v };
}

// ─── Hacker News ────────────────────────────────────────────────────────────

export async function scanHackerNews() {
  const src = config.sources.hackerNews;
  const logEntry = { source: "hackernews", topics_found: 0, topics_new: 0, error: "" };

  try {
    const idsRes = await fetch(`${src.apiBase}/topstories.json`, { signal: AbortSignal.timeout(10000) });
    const allIds = await idsRes.json();
    const ids = allIds.slice(0, src.topN);

    const items = await Promise.all(
      ids.map(id =>
        fetch(`${src.apiBase}/item/${id}.json`, { signal: AbortSignal.timeout(10000) })
          .then(r => r.json())
          .catch(() => null)
      )
    );

    for (const item of items) {
      if (!item || !item.title) continue;

      const matched = matchKeywords(item.title + " " + (item.url || ""));
      if (Object.keys(matched).length === 0) continue;

      logEntry.topics_found++;

      const niches = classifyNiches(matched);
      const content_type = classifyContentType(niches, matched);
      const ageHours = (Date.now() / 1000 - (item.time || 0)) / 3600;
      const titleShort = item.title.split(/[:.]/, 1)[0].trim();

      const raw_data = JSON.stringify({
        points: item.score || 0,
        comments: item.descendants || 0,
      });

      const topic = {
        id: `hn-${item.id}`,
        title: item.title,
        source: "hackernews",
        niches: JSON.stringify(niches),
        content_type,
        velocity: "",
        hook: `${titleShort}. I looked into the numbers.`,
        post_idea: `Reverse-engineer "${item.title}" for LinkedIn. Tie to growth/AI/crypto trend.`,
        source_url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        source_title: "Hacker News",
        hn_discussion_url: `https://news.ycombinator.com/item?id=${item.id}`,
        fact_checked: 0,
        fact_notes: "",
        raw_data,
        age_hours: Math.round(ageHours * 10) / 10,
        status: "new",
      };

      const scores = buildScore(topic);
      Object.assign(topic, scores);

      const isNew = upsertTopic(topic);
      if (isNew) logEntry.topics_new++;
    }
  } catch (err) {
    logEntry.error = err.message;
    console.error("[Scanner] HN error:", err.message);
  }

  insertScanLog(logEntry);
  return logEntry;
}

// ─── CoinGecko Trending ─────────────────────────────────────────────────────

export async function scanCoinGecko() {
  const src = config.sources.coinGecko;
  const logEntry = { source: "coingecko", topics_found: 0, topics_new: 0, error: "" };

  try {
    const res = await fetch(src.url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const coins = (data.coins || []).slice(0, src.maxCoins);

    for (const { item } of coins) {
      const name = item.name;
      const symbol = item.symbol;
      const priceChange = item.data?.price_change_percentage_24h?.usd || 0;
      const rank = item.market_cap_rank || 9999;

      logEntry.topics_found++;

      const niches = ["Crypto / Web3"];
      if (Math.abs(priceChange) > 15 || rank < 100) niches.push("GTM Strategy");

      const content_type = Math.abs(priceChange) > 25 ? "viral" : "expert";

      const hookPrice = Math.abs(priceChange) > 5
        ? `${name} ${priceChange > 0 ? "up" : "down"} ${Math.abs(priceChange).toFixed(1)}% in 24h. I dug into what's driving it.`
        : `${name} trending on CoinGecko (rank #${rank}). I dug into the story.`;

      const raw_data = JSON.stringify({
        market_cap_rank: rank,
        price_change_24h: priceChange,
        symbol,
      });

      const title = `${name} (${symbol}): ${priceChange > 0 ? "+" : ""}${priceChange.toFixed(1)}% in 24h, rank #${rank}`;

      const topic = {
        id: `cg-${item.id || symbol.toLowerCase()}`,
        title,
        source: "coingecko",
        niches: JSON.stringify(niches),
        content_type,
        velocity: `${priceChange > 0 ? "+" : ""}${priceChange.toFixed(1)}%`,
        hook: hookPrice,
        post_idea: `Reverse-engineer ${name} trending momentum. Tie to market sentiment and crypto/growth narrative.`,
        source_url: `https://www.coingecko.com/en/coins/${item.id || symbol.toLowerCase()}`,
        source_title: "CoinGecko Trending",
        hn_discussion_url: "",
        fact_checked: 0,
        fact_notes: "",
        raw_data,
        age_hours: 0,
        status: "new",
      };

      const scores = buildScore(topic);
      Object.assign(topic, scores);

      const isNew = upsertTopic(topic);
      if (isNew) logEntry.topics_new++;
    }
  } catch (err) {
    logEntry.error = err.message;
    console.error("[Scanner] CoinGecko error:", err.message);
  }

  insertScanLog(logEntry);
  return logEntry;
}

// ─── Product Hunt RSS ────────────────────────────────────────────────────────

export async function scanProductHunt() {
  const src = config.sources.productHunt;
  const logEntry = { source: "producthunt", topics_found: 0, topics_new: 0, error: "" };

  try {
    const feed = await rssParser.parseURL(src.rssUrl);

    for (const item of feed.items) {
      const text = (item.title || "") + " " + (item.contentSnippet || "");
      const matched = matchKeywords(text);
      if (Object.keys(matched).length === 0) continue;

      logEntry.topics_found++;

      const niches = classifyNiches(matched);
      if (!niches.includes("AI + Marketing") && !niches.includes("Growth Marketing")) continue;

      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      const ageHours = (Date.now() - pubDate.getTime()) / 3600000;

      const raw_data = JSON.stringify({ upvotes: 50 });

      const slug = (item.link || item.title || "")
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase()
        .slice(0, 40);

      const topic = {
        id: `ph-${slug}`,
        title: item.title || "Product Hunt Launch",
        source: "producthunt",
        niches: JSON.stringify(["AI + Marketing", ...niches.filter(n => n !== "AI + Marketing")]),
        content_type: "tools",
        velocity: "",
        hook: `${(item.title || "").trim()}. I tested it and here's what happened.`,
        post_idea: `Review and breakdown of ${item.title} — what it does, who it's for, growth angle.`,
        source_url: item.link || "https://www.producthunt.com",
        source_title: "Product Hunt",
        hn_discussion_url: "",
        fact_checked: 0,
        fact_notes: "",
        raw_data,
        age_hours: Math.round(ageHours * 10) / 10,
        status: "new",
      };

      const scores = buildScore(topic);
      Object.assign(topic, scores);

      const isNew = upsertTopic(topic);
      if (isNew) logEntry.topics_new++;
    }
  } catch (err) {
    logEntry.error = err.message;
    console.error("[Scanner] Product Hunt error:", err.message);
  }

  insertScanLog(logEntry);
  return logEntry;
}

// ─── Run all sources ─────────────────────────────────────────────────────────

export async function runScan() {
  console.log("[Scanner] Starting scan...");
  const results = await Promise.allSettled([
    config.sources.hackerNews.enabled  ? scanHackerNews()  : Promise.resolve(null),
    config.sources.coinGecko.enabled   ? scanCoinGecko()   : Promise.resolve(null),
    config.sources.productHunt.enabled ? scanProductHunt() : Promise.resolve(null),
  ]);

  const summary = results.map((r, i) => {
    const src = ["HN", "CG", "PH"][i];
    if (r.status === "fulfilled" && r.value) {
      return `${src}: +${r.value.topics_new} new`;
    }
    return `${src}: skipped`;
  });

  console.log(`[Scanner] Done. ${summary.join(" | ")}`);
  return results;
}
