import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import config from "./config.js";
import { runScan } from "./scanner.js";
import { generateDraft } from "./generator.js";
import {
  getTopics, getTopicById, updateTopicStatus,
  updateTopicDraft, getScans, getStats, getLastScanBySource,
  upsertTopic, db,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  return res.redirect("/login");
}

// ─── Login routes ─────────────────────────────────────────────────────────────

app.get("/login", (req, res) => {
  if (req.session?.authenticated) return res.redirect("/");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LinkedIn Content Engine — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090B;
      color: #e2e2e2;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #111113;
      border: 1px solid #1E1E22;
      border-radius: 12px;
      padding: 2.5rem;
      width: 100%;
      max-width: 380px;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
      background: linear-gradient(90deg, #EF4444, #F59E0B);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    p { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
    label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 0.4rem; }
    input {
      width: 100%;
      padding: 0.65rem 0.9rem;
      background: #09090B;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      color: #e2e2e2;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s;
      margin-bottom: 1.25rem;
    }
    input:focus { border-color: #EF4444; }
    button {
      width: 100%;
      padding: 0.7rem;
      background: linear-gradient(90deg, #EF4444, #F59E0B);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }
    .error { color: #EF4444; font-size: 0.82rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Content Engine</h1>
    <p>Spicy Analyst — Private Dashboard</p>
    ${req.query.error ? '<div class="error">Wrong password. Try again.</div>' : ""}
    <form method="POST" action="/login">
      <label>Password</label>
      <input type="password" name="password" autofocus autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`);
});

app.post("/login", (req, res) => {
  if (req.body.password === config.password) {
    req.session.authenticated = true;
    return req.session.save(() => res.redirect("/"));
  }
  return res.redirect("/login?error=1");
});

app.post("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ─── Static files (authenticated) ────────────────────────────────────────────

app.use(requireAuth);
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET /api/topics — list topics with optional filters
app.get("/api/topics", (req, res) => {
  try {
    const { source, type, niche, sort } = req.query;
    const topics = getTopics({ source, type, niche, sort });
    res.json(topics.map(parseTopic));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/topics/:id — single topic
app.get("/api/topics/:id", (req, res) => {
  const topic = getTopicById(req.params.id);
  if (!topic) return res.status(404).json({ error: "Not found" });
  res.json(parseTopic(topic));
});

// POST /api/topics/:id/generate — generate draft via Claude
app.post("/api/topics/:id/generate", async (req, res) => {
  const topic = getTopicById(req.params.id);
  if (!topic) return res.status(404).json({ error: "Not found" });

  try {
    const draft = await generateDraft(parseTopic(topic));
    res.json({ draft });
  } catch (err) {
    console.error("[Generate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/topics/:id/status — update topic status
app.post("/api/topics/:id/status", (req, res) => {
  const { status } = req.body;
  const allowed = ["new", "starred", "drafted", "published", "skipped"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

  const topic = getTopicById(req.params.id);
  if (!topic) return res.status(404).json({ error: "Not found" });

  updateTopicStatus(req.params.id, status);
  res.json({ ok: true, status });
});

// POST /api/topics/:id/draft — save manual draft edit
app.post("/api/topics/:id/draft", (req, res) => {
  const { draft } = req.body;
  if (draft === undefined) return res.status(400).json({ error: "Missing draft" });

  const topic = getTopicById(req.params.id);
  if (!topic) return res.status(404).json({ error: "Not found" });

  updateTopicDraft(req.params.id, draft);
  res.json({ ok: true });
});

// GET /api/stats — dashboard stats
app.get("/api/stats", (req, res) => {
  try {
    const stats = getStats();
    const lastScans = getLastScanBySource();
    res.json({ stats, lastScans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scans — last 10 scan results
app.get("/api/scans", (req, res) => {
  try {
    res.json(getScans());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scan — trigger manual scan
let scanRunning = false;
app.post("/api/scan", async (req, res) => {
  if (scanRunning) return res.json({ ok: true, message: "Scan already running" });
  scanRunning = true;
  res.json({ ok: true, message: "Scan started" });
  try {
    await runScan();
  } finally {
    scanRunning = false;
  }
});

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_TOPICS = [
  {
    id: "seed-polymarket",
    title: "Polymarket: $3.3B wagered, $980K ad spend. 3,300x ratio.",
    source: "seed",
    niches: '["Crypto / Web3", "GTM Strategy"]',
    content_type: "expert",
    score: 94, score_r: 30, score_e: 28, score_f: 12, score_v: 10,
    velocity: "+340%",
    hook: "$3.3B wagered on one election. $980K in ad spend. That's a 3,300x return on marketing.",
    post_idea: "Reverse-engineer Polymarket GTM. They DID spend on Meta ads ($980K) and influencers. The 'zero budget' narrative is a myth. 3 real growth drivers: event hijacking, earned media, dopamine-driven retention.",
    source_url: "https://defillama.com/protocol/polymarket",
    source_title: "Polymarket — DefiLlama",
    hn_discussion_url: "",
    fact_checked: 1,
    fact_notes: "TVL peak $450M (not $1B). $980K Meta ads confirmed (Sportico). Influencer deals confirmed (Fortune). $3.3B = election volume. Valuation: $9B (Feb 2026).",
    raw_data: "{}",
    age_hours: 36,
    status: "new",
    draft: "",
  },
  {
    id: "seed-perplexity",
    title: "Perplexity AI: $500M to $20B in 20 months. Zero paid acquisition.",
    source: "seed",
    niches: '["AI + Marketing", "GTM Strategy"]',
    content_type: "expert",
    score: 91, score_r: 30, score_e: 25, score_f: 8, score_v: 8,
    velocity: "+800%",
    hook: "Perplexity went from $500M to $20B in 20 months. 45M active users. And their growth playbook has zero paid acquisition.",
    post_idea: "GTM breakdown: how Perplexity grew through distribution partnerships (Samsung TVs, Airtel India 640% growth), not ads. AEO (Answer Engine Optimization). Not 'SEO is dead' but 'Here's how search behavior is shifting and what I'm testing.'",
    source_url: "https://sacra.com/c/perplexity/",
    source_title: "Perplexity revenue & valuation — Sacra",
    hn_discussion_url: "",
    fact_checked: 1,
    fact_notes: "Valuation $20B (Sep 2025, TechCrunch). ARR ~$148M (Sacra). 45M MAU. 780M queries/mo. Founded 2022. Airtel India: +640% YoY users in Q2 2025.",
    raw_data: "{}",
    age_hours: 48,
    status: "new",
    draft: "",
  },
];

function insertSeedData() {
  const exists = db.prepare("SELECT id FROM topics WHERE id = 'seed-polymarket'").get();
  if (exists) return;
  for (const topic of SEED_TOPICS) {
    upsertTopic(topic);
  }
  console.log("[Seed] Inserted 2 seed topics.");
}

// ─── Start server ─────────────────────────────────────────────────────────────

function parseTopic(t) {
  return {
    ...t,
    niches: safeJson(t.niches, []),
    raw_data: safeJson(t.raw_data, {}),
  };
}

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

app.listen(config.port, () => {
  console.log(`⚡ LinkedIn Content Engine running on http://localhost:${config.port}`);

  // Insert seed data
  insertSeedData();

  // Initial scan on startup
  setTimeout(() => runScan().catch(console.error), 2000);

  // Cron scan every 30 minutes
  cron.schedule(config.scanCron, () => {
    runScan().catch(console.error);
  });
});
