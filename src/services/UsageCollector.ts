import {
  getUsageStats,
  hasUsageAccessPermission,
} from '../native/NetworkUsageModule';
import { insertUsageRecord } from '../database/sqlite';

/**
 * Ilang oras paatras kukunin ang usage data kada collection cycle.
 * Kung every-hour tumatakbo ang background job, 1 hour ang sapat na window.
 */
const COLLECTION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resulta ng isang collection attempt — useful para sa logging/debugging
 * o para malaman ng caller (hal. background task) kung ano ang nangyari.
 */
export interface CollectionResult {
  success: boolean;
  recordCount: number;
  reason?: string;
}

/**
 * Pangunahing function na:
 * 1. Chinicheck kung may Usage Access permission
 * 2. Kinukuha ang network usage stats mula sa native module
 * 3. Ini-insert ang resulta sa SQLite queue (hindi pa sinesend kahit saan)
 *
 * Ito ang function na tatawagin ng background job kada oras.
 */
export async function collectAndStoreUsage(): Promise<CollectionResult> {
  try {
    const permitted = await hasUsageAccessPermission();

    if (!permitted) {
      return {
        success: false,
        recordCount: 0,
        reason: 'Walang Usage Access permission. Kailangan payagan muna sa Settings.',
      };
    }

    const now = Date.now();
    const startTime = now - COLLECTION_WINDOW_MS;

    const entries = await getUsageStats(startTime, now);

    if (!entries || entries.length === 0) {
      return {
        success: true,
        recordCount: 0,
        reason: 'Walang na-detect na usage sa window na ito.',
      };
    }

    await insertUsageRecord(entries);

    return {
      success: true,
      recordCount: entries.length,
    };
  } catch (error) {
    return {
      success: false,
      recordCount: 0,
      reason: error instanceof Error ? error.message : 'Hindi kilalang error.',
    };
  }
}