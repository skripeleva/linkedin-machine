import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use RAILWAY_VOLUME_MOUNT_PATH if available (persistent disk on Railway)
const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "data.db")
  : path.join(__dirname, "..", "data.db");

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    niches TEXT NOT NULL,
    content_type TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    score_r INTEGER DEFAULT 0,
    score_e INTEGER DEFAULT 0,
    score_f INTEGER DEFAULT 0,
    score_v INTEGER DEFAULT 0,
    velocity TEXT DEFAULT '',
    hook TEXT DEFAULT '',
    post_idea TEXT DEFAULT '',
    source_url TEXT DEFAULT '',
    source_title TEXT DEFAULT '',
    hn_discussion_url TEXT DEFAULT '',
    fact_checked INTEGER DEFAULT 0,
    fact_notes TEXT DEFAULT '',
    raw_data TEXT DEFAULT '{}',
    age_hours REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'new',
    draft TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    topics_found INTEGER DEFAULT 0,
    topics_new INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    scanned_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Prepared statements ────────────────────────────────────────────────────

const stmtUpsertTopic = db.prepare(`
  INSERT INTO topics (
    id, title, source, niches, content_type,
    score, score_r, score_e, score_f, score_v,
    velocity, hook, post_idea, source_url, source_title,
    hn_discussion_url, fact_checked, fact_notes, raw_data, age_hours, status
  ) VALUES (
    @id, @title, @source, @niches, @content_type,
    @score, @score_r, @score_e, @score_f, @score_v,
    @velocity, @hook, @post_idea, @source_url, @source_title,
    @hn_discussion_url, @fact_checked, @fact_notes, @raw_data, @age_hours, @status
  )
  ON CONFLICT(id) DO UPDATE SET
    score       = excluded.score,
    score_r     = excluded.score_r,
    score_e     = excluded.score_e,
    score_f     = excluded.score_f,
    score_v     = excluded.score_v,
    age_hours   = excluded.age_hours,
    hook        = excluded.hook,
    post_idea   = excluded.post_idea,
    updated_at  = datetime('now')
  WHERE topics.status NOT IN ('starred', 'published')
`);

const stmtInsertScanLog = db.prepare(`
  INSERT INTO scan_log (source, topics_found, topics_new, error)
  VALUES (@source, @topics_found, @topics_new, @error)
`);

const stmtGetTopics = db.prepare(`
  SELECT * FROM topics
  WHERE status NOT IN ('published', 'skipped')
  ORDER BY
    CASE WHEN status = 'starred' THEN 0 ELSE 1 END ASC,
    score DESC
  LIMIT 50
`);

const stmtGetTopicById = db.prepare(`SELECT * FROM topics WHERE id = ?`);

const stmtUpdateStatus = db.prepare(`
  UPDATE topics SET status = ?, updated_at = datetime('now') WHERE id = ?
`);

const stmtUpdateDraft = db.prepare(`
  UPDATE topics SET draft = ?, status = 'drafted', updated_at = datetime('now') WHERE id = ?
`);

const stmtGetScans = db.prepare(`
  SELECT * FROM scan_log ORDER BY scanned_at DESC LIMIT 10
`);

const stmtStats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
    SUM(CASE WHEN status = 'starred' THEN 1 ELSE 0 END) as starred,
    SUM(CASE WHEN status = 'drafted' THEN 1 ELSE 0 END) as drafted,
    SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
    SUM(CASE WHEN source = 'hackernews' THEN 1 ELSE 0 END) as hn_count,
    SUM(CASE WHEN source = 'coingecko'  THEN 1 ELSE 0 END) as cg_count,
    SUM(CASE WHEN source = 'producthunt' THEN 1 ELSE 0 END) as ph_count,
    SUM(CASE WHEN source = 'seed' THEN 1 ELSE 0 END) as seed_count
  FROM topics
`);

const stmtLastScanBySource = db.prepare(`
  SELECT source, MAX(scanned_at) as last_scan, SUM(CASE WHEN error != '' THEN 1 ELSE 0 END) as errors
  FROM scan_log
  GROUP BY source
`);

const stmtTopicExists = db.prepare(`SELECT id FROM topics WHERE id = ?`);

// ─── Public API ─────────────────────────────────────────────────────────────

export function upsertTopic(topic) {
  const isNew = !stmtTopicExists.get(topic.id);
  stmtUpsertTopic.run(topic);
  return isNew;
}

export function insertScanLog(entry) {
  stmtInsertScanLog.run(entry);
}

export function getTopics({ source, type, niche, sort } = {}) {
  let query = `
    SELECT * FROM topics
    WHERE status NOT IN ('published', 'skipped')
  `;
  const params = [];

  if (source) {
    query += ` AND source = ?`;
    params.push(source);
  }
  if (type) {
    query += ` AND content_type = ?`;
    params.push(type);
  }
  if (niche) {
    query += ` AND niches LIKE ?`;
    params.push(`%${niche}%`);
  }

  if (sort === "fresh") {
    query += ` ORDER BY CASE WHEN status = 'starred' THEN 0 ELSE 1 END ASC, age_hours ASC`;
  } else {
    query += ` ORDER BY CASE WHEN status = 'starred' THEN 0 ELSE 1 END ASC, score DESC`;
  }

  query += ` LIMIT 50`;

  return db.prepare(query).all(...params);
}

export function getTopicById(id) {
  return stmtGetTopicById.get(id);
}

export function updateTopicStatus(id, status) {
  stmtUpdateStatus.run(status, id);
}

export function updateTopicDraft(id, draft) {
  stmtUpdateDraft.run(draft, id);
}

export function getScans() {
  return stmtGetScans.all();
}

export function getStats() {
  return stmtStats.get();
}

export function getLastScanBySource() {
  return stmtLastScanBySource.all();
}

export { db };
