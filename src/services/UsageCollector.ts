import {
  getUsageStats,
  hasUsageAccessPermission,
} from '../native/NetworkUsageModule';
import {
  insertUsageRecord,
  getLastCollectionEndTime,
  setLastCollectionEndTime,
} from '../database/sqlite';
import { formatBytes, formatTimestamp } from '../utils/format';

// Fallback lang ito kapag WALA pang naka-save na huling collection
// (hal. unang run pagka-install ng app)
const FALLBACK_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface CollectionResult {
  success: boolean;
  recordCount: number;
  reason?: string;
}

export interface FormattedUsageEntry {
  packageName: string;
  uid: number;
  type: 'wifi' | 'data';
  downloadSize: string;
  uploadSize: string;
  downloadBytes: number; // ← raw bytes, para sa pag-compute/filter (hal. 100MB+)
  uploadBytes: number; // ← raw bytes, para sa pag-compute/filter (hal. 100MB+)
  timestamp: string;
  versionName: string; // ← version ng app noong na-collect
  versionCode: number;
}

export async function collectAndStoreUsage(): Promise<CollectionResult> {
  console.log('[UsageCollector] Simula ng collection...');
  try {
    const permitted = await hasUsageAccessPermission();
    console.log('[UsageCollector] hasUsageAccessPermission:', permitted);

    if (!permitted) {
      console.log('[UsageCollector] BLOCKED — walang Usage Access permission.');
      return {
        success: false,
        recordCount: 0,
        reason: 'Walang Usage Access permission. Kailangan payagan muna sa Settings.',
      };
    }

    const now = Date.now();

    // Gamitin ang dulo ng HULING successful collection bilang simula
    // ng window na ito — para walang overlap (double-count) at walang
    // gap (nawawalang data) sa pagitan ng mga collection.
    const lastEndTime = await getLastCollectionEndTime();
    const startTime = lastEndTime ?? now - FALLBACK_WINDOW_MS;

    console.log(
      '[UsageCollector] Query window:',
      new Date(startTime),
      '->',
      new Date(now),
      lastEndTime ? '(continuous mula sa huling collection)' : '(fallback 1-hour window)'
    );

    const entries = await getUsageStats(startTime, now);
    console.log('[UsageCollector] Entries mula sa native module:', entries?.length, entries);

    if (!entries || entries.length === 0) {
      console.log('[UsageCollector] Walang entries — walang ipapasok sa DB.');
      await setLastCollectionEndTime(now);
      return {
        success: true,
        recordCount: 0,
        reason: 'Walang na-detect na usage sa window na ito.',
      };
    }

    // I-format bago i-save (kasama na ang raw bytes para sa filtering)
    const formattedEntries: FormattedUsageEntry[] = entries.map((entry) => ({
      packageName: entry.packageName,
      uid: entry.uid,
      type: entry.type,
      downloadSize: formatBytes(entry.rxBytes),
      uploadSize: formatBytes(entry.txBytes),
      downloadBytes: entry.rxBytes,
      uploadBytes: entry.txBytes,
      timestamp: formatTimestamp(entry.timestamp),
      versionName: entry.versionName ?? '',
      versionCode: entry.versionCode ?? 0,
    }));

    const insertedId = await insertUsageRecord(formattedEntries);
    console.log('[UsageCollector] Na-insert, id:', insertedId);

    await setLastCollectionEndTime(now);

    return {
      success: true,
      recordCount: formattedEntries.length,
    };
  } catch (error) {
    console.log('[UsageCollector] ERROR:', error);
    return {
      success: false,
      recordCount: 0,
      reason: error instanceof Error ? error.message : 'Hindi kilalang error.',
    };
  }
}