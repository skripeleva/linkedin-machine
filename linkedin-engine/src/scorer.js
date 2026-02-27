import config from "./config.js";

/**
 * Score = Relevance(0-40) + Engagement(0-30) + Freshness(0-20) + Virality(0-10)
 */

export function scoreRelevance(title, niches) {
  let score = 0;
  const titleLower = title.toLowerCase();

  // +10 per matching niche (max 4 niches)
  const matchedNiches = niches.filter(n => n);
  score += matchedNiches.length * 10;

  // +5 per strong keyword in title
  for (const kw of config.strongKeywords) {
    if (titleLower.includes(kw)) score += 5;
  }

  return Math.min(40, score);
}

export function scoreEngagement(source, data) {
  const { points, comments, market_cap_rank, price_change_24h, upvotes } = data;

  if (source === "hackernews") {
    const pts = points || 0;
    return Math.min(30, Math.round(Math.log2(pts + 1) * 3));
  }

  if (source === "coingecko") {
    const rank = market_cap_rank || 9999;
    if (rank <= 50)  return 28;
    if (rank <= 100) return 22;
    if (rank <= 300) return 16;
    return 10;
  }

  if (source === "producthunt") {
    const up = upvotes || 50;
    return Math.min(30, Math.round(Math.log2(up + 1) * 3.5));
  }

  // seed or unknown
  return 20;
}

export function scoreFreshness(ageHours) {
  if (ageHours < 2)  return 20;
  if (ageHours < 6)  return 16;
  if (ageHours < 12) return 12;
  if (ageHours < 24) return 8;
  return 4;
}

export function scoreVirality(source, data) {
  const { comments, price_change_24h } = data;
  let bonus = 0;

  if (source === "hackernews") {
    const c = comments || 0;
    if (c > 50)  bonus += 3;
    if (c > 200) bonus += 4;
  }

  if (source === "coingecko") {
    const pct = Math.abs(price_change_24h || 0);
    if (pct > 20) bonus += 5;
    if (pct > 50) bonus += 5;
  }

  return Math.min(10, bonus);
}

export function computeScore(topic) {
  const niches = JSON.parse(topic.niches || "[]");
  const raw = JSON.parse(topic.raw_data || "{}");

  const score_r = scoreRelevance(topic.title, niches);
  const score_e = scoreEngagement(topic.source, raw);
  const score_f = scoreFreshness(topic.age_hours || 0);
  const score_v = scoreVirality(topic.source, raw);

  return {
    score_r,
    score_e,
    score_f,
    score_v,
    score: score_r + score_e + score_f + score_v,
  };
}
