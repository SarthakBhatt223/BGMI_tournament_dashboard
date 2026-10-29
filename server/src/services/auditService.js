// Audit log of administrative actions. Details are small JSON objects describing what changed.
// Never put secrets or unnecessary personal data in `details`.

export function recordAudit(db, eventId, action, entityType, entityId, details = {}) {
  db.prepare(
    'INSERT INTO audit_log (event_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)',
  ).run(eventId, action, entityType, entityId ?? null, JSON.stringify(details));
}

export function listAuditEntries(db, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return db
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(safeLimit)
    .map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: JSON.parse(row.details_json),
      createdAt: row.created_at,
    }));
}
