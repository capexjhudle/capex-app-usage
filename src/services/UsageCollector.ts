import {
  getUsageStats,
  hasUsageAccessPermission,
} from '../native/NetworkUsageModule';
import { insertUsageRecord } from '../database/sqlite';
import { formatBytes, formatTimestamp } from '../utils/format';

const COLLECTION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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
  timestamp: string;
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
    const startTime = now - COLLECTION_WINDOW_MS;
    console.log('[UsageCollector] Query window:', new Date(startTime), '->', new Date(now));

    const entries = await getUsageStats(startTime, now);
    console.log('[UsageCollector] Entries mula sa native module:', entries?.length, entries);

    if (!entries || entries.length === 0) {
      console.log('[UsageCollector] Walang entries — walang ipapasok sa DB.');
      return {
        success: true,
        recordCount: 0,
        reason: 'Walang na-detect na usage sa window na ito.',
      };
    }

    // I-format bago i-save
    const formattedEntries: FormattedUsageEntry[] = entries.map((entry) => ({
      packageName: entry.packageName,
      uid: entry.uid,
      type: entry.type,
      downloadSize: formatBytes(entry.rxBytes),
      uploadSize: formatBytes(entry.txBytes),
      timestamp: formatTimestamp(entry.timestamp),
    }));

    const insertedId = await insertUsageRecord(formattedEntries);
    console.log('[UsageCollector] Na-insert, id:', insertedId);

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