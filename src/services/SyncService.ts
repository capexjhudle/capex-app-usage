import {
  getUnsentRecords,
  markRecordsAsSent,
  UsageQueueRow,
} from '../database/sqlite';
import { sendUsagePayload, UsageApiEntry } from '../api/usageApi';
import { getUniqueDeviceId } from '../native/DeviceInfoModule';
import { FormattedUsageEntry } from './UsageCollector';
import { formatTimestamp } from '../utils/format';

export interface SyncResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  reason?: string;
}

/**
 * Mga oras (24-hr, local time) na dapat i-SKIP ang sync dahil dito
 * nagba-backup ang system: 12:00 nn at 6:30 pm. May buffer (minutes)
 * bago at pagkatapos ng exact na oras para siguradong hindi mag-overlap.
 */
const BLACKOUT_WINDOWS: Array<{
  hour: number;
  minute: number;
  bufferMinutes: number;
}> = [
  { hour: 12, minute: 0, bufferMinutes: 20 }, // 12:00 nn
  { hour: 18, minute: 30, bufferMinutes: 20 }, // 6:30 pm
];

/**
 * Tinitingnan kung malapit tayo sa isang blackout window ngayon.
 * Kung oo, dapat i-skip muna ang sync at subukan na lang mamaya.
 */
export function isInBlackoutWindow(date: Date = new Date()): boolean {
  const nowMinutes = date.getHours() * 60 + date.getMinutes();

  return BLACKOUT_WINDOWS.some(({ hour, minute, bufferMinutes }) => {
    const target = hour * 60 + minute;
    return Math.abs(nowMinutes - target) <= bufferMinutes;
  });
}

/**
 * I-send ang lahat ng unsent records isa-isa papunta sa backend.
 * Bawat successful send ay ma-mamark na "sent" sa local DB.
 */
export async function syncPendingRecords(): Promise<SyncResult> {
  if (isInBlackoutWindow()) {
    console.log(
      '[SyncService] Malapit sa oras ng system backup — i-skip muna ang sync.'
    );
    return {
      success: true,
      sentCount: 0,
      failedCount: 0,
      reason: 'Naka-skip dahil malapit sa oras ng system backup.',
    };
  }

  const unsentRecords: UsageQueueRow[] = await getUnsentRecords();

  if (unsentRecords.length === 0) {
    console.log('[SyncService] Walang unsent records — wala munang isesend.');
    return { success: true, sentCount: 0, failedCount: 0 };
  }

  let deviceId: string;
  try {
    deviceId = await getUniqueDeviceId();
  } catch (error) {
    console.warn('[SyncService] Hindi makuha ang device ID:', error);
    return {
      success: false,
      sentCount: 0,
      failedCount: unsentRecords.length,
      reason: 'Hindi makuha ang device identifier.',
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  const sentIds: number[] = [];

  for (const record of unsentRecords) {
    let storedEntries: FormattedUsageEntry[];
    try {
      storedEntries = JSON.parse(record.payload);
    } catch (error) {
      console.warn(
        `[SyncService] Sirang payload sa record ${record.id}, i-skip:`,
        error
      );
      failedCount += 1;
      continue;
    }

    // Ang naka-store sa DB ay may extra fields (raw bytes, timestamp).
    // Yung inaasahan lang ng backend ang ipapadala natin.
    const payloads: UsageApiEntry[] = storedEntries.map((entry) => ({
      type: entry.type,
      packageName: entry.packageName,
      downloadSize: entry.downloadSize,
      uploadSize: entry.uploadSize,
      uid: entry.uid,
      // Ang mga lumang record (na-store bago pa may version tracking) ay
      // walang version fields — default na lang para consistent ang shape
      // ng ipinapadala natin sa backend.
      versionName: entry.versionName ?? '',
      versionCode: entry.versionCode ?? 0,
    }));

    const result = await sendUsagePayload({
      device_id: deviceId,
      collected_at: formatTimestamp(record.collected_at),
      payloads,
    });

    if (result.success) {
      sentCount += 1;
      sentIds.push(record.id);
      console.log(`[SyncService] Naipadala ang record ${record.id}.`);
    } else {
      failedCount += 1;
      console.warn(
        `[SyncService] Hindi naipadala ang record ${record.id}:`,
        result.error
      );
    }
  }

  if (sentIds.length > 0) {
    await markRecordsAsSent(sentIds);
  }

  return {
    success: failedCount === 0,
    sentCount,
    failedCount,
    reason:
      failedCount > 0 ? `${failedCount} record(s) ang hindi naipadala.` : undefined,
  };
}