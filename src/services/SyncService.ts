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

interface BlackoutWindow {
  /** Simula ng window, bilang minuto mula hatinggabi (inclusive). */
  startMinute: number;
  /** Katapusan ng window, bilang minuto mula hatinggabi (exclusive). */
  endMinute: number;
  label: string;
}

/**
 * Mga oras (24-hr, local time) na dapat i-SKIP ang collection at sync dahil
 * dito nagba-backup ang system. Explicit na range (simula–katapusan) para
 * malinaw kung kailan eksakto nagsisimula at natatapos ang pag-iwas:
 *
 *   • 12:00 nn  –  1:00 pm
 *   • 6:30 pm   –  7:00 pm
 *
 * Dahil naka-tuwing-alas-hero (:00) ang schedule ng app, ang epekto nito ay:
 * naka-skip ang 12:00 nn na run (11:00 am → deretso 1:00 pm), at ang 7:00 pm
 * na run ay tumatakbo na dahil tapos na ang window sa 7:00 pm mismo.
 *
 * DITO LANG dapat may hipuin kung magbabago ang oras ng backup.
 */
const BLACKOUT_WINDOWS: BlackoutWindow[] = [
  { startMinute: 12 * 60, endMinute: 13 * 60, label: '12:00nn–1:00pm' },
  { startMinute: 18 * 60 + 30, endMinute: 19 * 60, label: '6:30pm–7:00pm' },
];

/**
 * Hinahanap ang blackout window na kinapapalooban ng ibinigay na oras.
 * Null kung malinis ang oras na iyon.
 */
function findBlackoutWindow(date: Date): BlackoutWindow | null {
  const nowMinutes = date.getHours() * 60 + date.getMinutes();

  return (
    BLACKOUT_WINDOWS.find(
      ({ startMinute, endMinute }) =>
        nowMinutes >= startMinute && nowMinutes < endMinute
    ) ?? null
  );
}

/**
 * Tinitingnan kung nasa loob tayo ng blackout window ngayon.
 * Kung oo, dapat i-skip muna ang run at subukan na lang pagkatapos ng window.
 */
export function isInBlackoutWindow(date: Date = new Date()): boolean {
  return findBlackoutWindow(date) !== null;
}

/**
 * Ilang milliseconds pa bago matapos ang blackout window na kinapapalooban ng
 * `date`. 0 kung wala naman tayo sa loob ng anumang window — kaya pwede itong
 * gamitin ng scheduler para itulak ang isang run palabas ng window.
 */
export function msUntilBlackoutEnds(date: Date = new Date()): number {
  const window = findBlackoutWindow(date);

  if (!window) {
    return 0;
  }

  // setMinutes() ang bahalang mag-rollover papuntang tamang oras
  // (hal. 750 minuto → 12:30 pm).
  const endOfWindow = new Date(date);
  endOfWindow.setHours(0, 0, 0, 0);
  endOfWindow.setMinutes(window.endMinute);

  return endOfWindow.getTime() - date.getTime();
}

/**
 * I-send ang lahat ng unsent records isa-isa papunta sa backend.
 * Bawat successful send ay ma-mamark na "sent" sa local DB.
 */
export async function syncPendingRecords(): Promise<SyncResult> {
  const blackout = findBlackoutWindow(new Date());

  if (blackout) {
    console.log(
      `[SyncService] Nasa oras ng system backup (${blackout.label}) — i-skip muna ang sync.`
    );
    return {
      success: true,
      sentCount: 0,
      failedCount: 0,
      reason: `Naka-skip dahil oras ng system backup (${blackout.label}).`,
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