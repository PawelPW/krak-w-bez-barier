import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const repoRoot = resolve(import.meta.dirname, '../../..');
export const dataDir = process.env.DATA_DIR ?? resolve(repoRoot, 'var');
mkdirSync(resolve(dataDir, 'photos'), { recursive: true });

export const db = new DatabaseSync(resolve(dataDir, 'kbg.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS authors (id TEXT PRIMARY KEY, reputation REAL NOT NULL DEFAULT 0.5);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL, feature_id TEXT, lon REAL, lat REAL,
  ai_result TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL,
  source TEXT NOT NULL, author_id TEXT, observed_at TEXT NOT NULL, valid_until TEXT, photo_id TEXT);
CREATE INDEX IF NOT EXISTS obs_feature_attr ON observations (feature_id, attr);
CREATE INDEX IF NOT EXISTS obs_valid_until ON observations (valid_until) WHERE valid_until IS NOT NULL;
CREATE TABLE IF NOT EXISTS verifications (
  observation_id TEXT NOT NULL, author_id TEXT NOT NULL, agree INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (observation_id, author_id));
CREATE TABLE IF NOT EXISTS attribute_states (
  feature_id TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL, confidence REAL NOT NULL,
  last_confirmed TEXT NOT NULL, sources TEXT NOT NULL, unconfirmed INTEGER NOT NULL,
  PRIMARY KEY (feature_id, attr));
`);
