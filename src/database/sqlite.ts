import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

const DATABASE_NAME = 'usage_collector.db';
const TABLE_NAME = 'usage_queue';
const META_TABLE_NAME = 'collection_meta';
const LAST_COLLECTION_END_KEY = 'last_collection_end';

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

  // ↓↓↓ IDAGDAG MO ITO DITO ↓↓↓
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      device_id TEXT NOT NULL,
      registered_at INTEGER NOT NULL
    );
  `);


  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS collection_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
 * Kunin lahat ng records na nasa DB pa.
 *
 * Dahil binubura na natin ang mga naipadala na (tingnan ang
 * deleteSentRecords), ang laman nito ay ang mga HINDI PA naipapadala —
 * ito ang ipinapakita sa UI.
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
 * Burahin na ang mga record na matagumpay nang naipadala sa API.
 *
 * DELETE ito (hindi na lang pag-mark ng sent = 1) para hindi lumaki nang
 * walang hanggan ang local DB — ang backend na ang mapagkukunan ng history.
 *
 * Ibig sabihin nito, ang natitira sa `usage_queue` ay puro `sent = 0` na
 * lang — mga hindi pa naipapadala. Hindi na mababawi ang mga naipadala na,
 * kaya siguraduhing tumatanggap talaga ang server bago ito tawagin.
 */
export async function deleteSentRecords(ids: number[]): Promise<void> {
  if (ids.length === 0) return;

  const db = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  await db.executeSql(
    `DELETE FROM ${TABLE_NAME} WHERE id IN (${placeholders});`,
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

// ↓↓↓ IDAGDAG MO ITONG LAHAT DITO, DULO NG FILE ↓↓↓

/**
 * Shape ng user profile row
 */
export interface UserProfileRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  device_id: string;
  registered_at: number;
}

/**
 * I-save ang registration info ng user. Isang beses lang dapat
 * ito tumakbo — sa first launch.
 */
export async function saveUserProfile(
  name: string,
  email: string,
  phone: string,
  deviceId: string
): Promise<number> {
  const db = await getDb();
  const registeredAt = Date.now();

  const [result] = await db.executeSql(
    `INSERT INTO user_profile (name, email, phone, device_id, registered_at) VALUES (?, ?, ?, ?, ?);`,
    [name, email, phone, deviceId, registeredAt]
  );

  return result.insertId;
}

/**
 * Kunin ang naka-save na profile, kung meron. Null kung wala pang
 * nag-rerehistro (ibig sabihin, first launch pa).
 */
export async function getUserProfile(): Promise<UserProfileRow | null> {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM user_profile ORDER BY id DESC LIMIT 1;`
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows.item(0);
}

/**
 * Mabilis na check kung naka-rehistro na ang device na ito.
 */
export async function isUserRegistered(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile !== null;
}

/**
 * Kunin ang timestamp (ms) kung saan natapos ang HULING successful
 * collection window. Null kung wala pa (unang beses pa lang).
 */
export async function getLastCollectionEndTime(): Promise<number | null> {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT value FROM ${META_TABLE_NAME} WHERE key = ? LIMIT 1;`,
    [LAST_COLLECTION_END_KEY]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const value = result.rows.item(0).value;
  return value ? Number(value) : null;
}

/**
 * I-save ang timestamp (ms) ng dulo ng huling successful collection window.
 * Ito ang gagamiting `startTime` ng SUSUNOD na collection, para walang
 * overlap at walang gap sa pagitan ng mga window.
 */
export async function setLastCollectionEndTime(timestamp: number): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    `INSERT INTO ${META_TABLE_NAME} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [LAST_COLLECTION_END_KEY, String(timestamp)]
  );
}