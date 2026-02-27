const config = {
  password: process.env.ENGINE_PASSWORD || "spicyanalyst2026",
  port: process.env.PORT || 3000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  model: "claude-sonnet-4-5-20250929",
  sessionSecret: process.env.SESSION_SECRET || "linkedin-engine-secret-2026",
  scanCron: "*/30 * * * *",

  keywords: {
    ai: ["ai","llm","gpt","claude","openai","anthropic","ml","agent","automation","rag","chatbot","gemini","copilot"],
    crypto: ["crypto","blockchain","web3","token","defi","prediction","airdrop","tvl","l2","rollup","staking"],
    growth: ["growth","marketing","startup","saas","fundrais","series","valuation","revenue","arr","cac","ltv","retention","gtm"],
  },

  strongKeywords: [
    "growth hack","gtm","zero budget","tvl","arr","valuation","fundrais",
    "airdrop","ai agent","retention","cac","ltv","prediction market",
    "product-led","viral loop","series a","series b","ipo","acquisition",
  ],

  sources: {
    hackerNews:  { enabled: true, topN: 30, apiBase: "https://hacker-news.firebaseio.com/v0" },
    coinGecko:   { enabled: true, url: "https://api.coingecko.com/api/v3/search/trending", maxCoins: 8 },
    productHunt: { enabled: true, rssUrl: "https://www.producthunt.com/feed" },
  },
};

export default config;
