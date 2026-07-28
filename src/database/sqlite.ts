import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

const DATABASE_NAME = 'usage_collector.db';
const TABLE_NAME = 'usage_queue';

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Row shape ng usage_queue table
 */
export interface UsageQueueRow {
  id: number;
  payload: string; // JSON string
  collected_at: number; // timestamp (ms)
  sent: number; // 0 o 1
}

/**
 * Buksan (o gumawa) ng database at siguraduhing existing ang table.
 * Tawagin ito once sa app startup (halimbawa sa App.tsx o sa isang init function).
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  const db = await SQLite.openDatabase({
    name: DATABASE_NAME,
    location: 'default',
  });

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      collected_at INTEGER NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0
    );
  `);

  dbInstance = db;
  return db;
}

/**
 * Kunin ang existing DB instance. Tatawagin ang initDatabase() kung
 * hindi pa naka-open.
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

/**
 * Mag-insert ng bagong usage snapshot sa queue.
 * Ang `payload` ay dapat naka-JSON.stringify na (halimbawa: buong array
 * ng NetworkUsageEntry mula sa native module).
 */
export async function insertUsageRecord(payload: unknown): Promise<number> {
  console.log('[sqlite] insertUsageRecord called, payload length:', Array.isArray(payload) ? payload.length : 'n/a');
  const db = await getDb();
  const payloadString = JSON.stringify(payload);
  const collectedAt = Date.now();

  const [result] = await db.executeSql(
    `INSERT INTO ${TABLE_NAME} (payload, collected_at, sent) VALUES (?, ?, 0);`,
    [payloadString, collectedAt]
  );

  console.log('[sqlite] Insert result — insertId:', result.insertId, 'rowsAffected:', result.rowsAffected);
  return result.insertId;
}

/**
 * Kunin lahat ng records na hindi pa sent (sent = 0).
 * Gagamitin ito sa susunod na phase kapag ginawa na natin ang sending logic.
 */
export async function getUnsentRecords(): Promise<UsageQueueRow[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM ${TABLE_NAME} WHERE sent = 0 ORDER BY collected_at ASC;`
  );

  const rows: UsageQueueRow[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    rows.push(result.rows.item(i));
  }
  return rows;
}

/**
 * Kunin LAHAT ng records (sent man o hindi) — useful para sa debugging
 * o sa pag-display ng history sa UI.
 */
export async function getAllRecords(): Promise<UsageQueueRow[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM ${TABLE_NAME} ORDER BY collected_at DESC;`
  );

  const rows: UsageQueueRow[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    rows.push(result.rows.item(i));
  }
  return rows;
}

/**
 * Markahan ang mga ibinigay na record IDs bilang sent = 1.
 * (Ito ay gagamitin sa susunod na phase, pagkatapos ng successful upload.)
 */
export async function markRecordsAsSent(ids: number[]): Promise<void> {
  if (ids.length === 0) return;

  const db = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  await db.executeSql(
    `UPDATE ${TABLE_NAME} SET sent = 1 WHERE id IN (${placeholders});`,
    ids
  );
}

/**
 * Bilangin ang mga hindi pa naipapadalang records.
 * Useful para sa pag-display ng "X records pending" sa UI.
 */
export async function countUnsentRecords(): Promise<number> {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT COUNT(*) as count FROM ${TABLE_NAME} WHERE sent = 0;`
  );
  return result.rows.item(0).count;
}

/**
 * Burahin ang mga record na sent = 1 at mas matanda sa `olderThanMs`.
 * Optional cleanup function para hindi lumaki ng sobra ang local DB.
 */
export async function deleteOldSentRecords(olderThanMs: number): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - olderThanMs;
  await db.executeSql(
    `DELETE FROM ${TABLE_NAME} WHERE sent = 1 AND collected_at < ?;`,
    [cutoff]
  );
}