// Database access: opens SQLite and provides the transaction helper.
//
// Driver choice: node:sqlite, the SQLite module built into Node.js 22.13+. It offers prepared
// statements and parameter binding, needs no native compilation on macOS, and adds no
// dependency. Its API is close to better-sqlite3, so swapping later only touches this file
// and the few places that call db.prepare / db.exec.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  if (databasePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

const transactionDepthByDatabase = new WeakMap();

// Runs `work` in one transaction. A nested call joins the outer transaction, so service
// functions can call each other safely. Any thrown error rolls everything back.
export function runInTransaction(db, work) {
  if ((transactionDepthByDatabase.get(db) ?? 0) > 0) {
    return work();
  }
  db.exec('BEGIN IMMEDIATE');
  transactionDepthByDatabase.set(db, 1);
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction was already closed by SQLite; the original error is what matters.
    }
    throw error;
  } finally {
    transactionDepthByDatabase.set(db, 0);
  }
}

// node:sqlite stores integers as numbers and has no boolean type.
export const toFlag = (value) => (value ? 1 : 0);
