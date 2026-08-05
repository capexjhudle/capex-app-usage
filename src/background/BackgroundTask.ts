import BackgroundFetch from 'react-native-background-fetch';
import { collectAndStoreUsage } from '../services/UsageCollector';
import {
  syncPendingRecords,
  isInBlackoutWindow,
  msUntilBlackoutEnds,
} from '../services/SyncService';
import { getLastCollectionEndTime } from '../database/sqlite';

/**
 * ISANG task lang ang humahawak ng buong hourly cycle: kolekta muna, tapos
 * agad i-send sa API. Dati ay hiwalay ang dalawa (collect kada oras, sync
 * kada 4 oras) — pinagsama na para tugma sa requirement na KADA ORAS ang
 * pag-store AT ang pag-send.
 */
const HOURLY_TASK_ID = 'com.capexusagecollector.hourly-collect';

/**
 * Task ID ng lumang 4-hour sync chain. Wala na tayong ini-schedule dito;
 * kinakansela na lang natin para hindi mag-double-fire sa mga device na
 * na-update mula sa lumang bersyon.
 */
const LEGACY_SYNC_TASK_ID = 'com.capexusagecollector.sync-usage';

/**
 * Fallback/watchdog fetch (minuto). Hindi ito ang pangunahing schedule —
 * ang trabaho lang nito ay tiyaking buhay pa ang hourly chain kahit
 * napatay ito ng OS, ng battery optimizer, o ng mahabang power-off.
 */
const WATCHDOG_INTERVAL_MINUTES = 60;

/**
 * Kung mas matanda pa rito ang huling successful collection, ibig sabihin
 * may na-miss tayong hourly run. Mag-catch-up agad ang watchdog imbes na
 * hintayin pa ang susunod na :00.
 *
 * 130 minuto ito (hindi 60) dahil normal na may 2-orasang agwat kapag
 * nilaktawan ang 12:00 nn — 11:00 am hanggang 1:00 pm. Ayaw nating ituring
 * iyon na "may na-miss". Kapag pinaikli mo ang blackout window, pwede mo
 * rin itong bawasan.
 */
const CATCHUP_THRESHOLD_MS = 130 * 60 * 1000;

/** Hindi tayo mag-se-schedule ng mas maikli pa rito — iwas tight loop. */
const MIN_DELAY_MS = 60 * 1000;

/**
 * Susunod na buong oras (hal. kung 5:23 pm ngayon, 6:00 pm ang ibabalik).
 */
function nextTopOfHour(from: Date): Date {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(from.getHours() + 1);
  return next;
}

/**
 * Kung ang target na oras ay nasa loob ng blackout window, itulak ito sa
 * dulo ng window (hal. 12:00 nn → 12:30 pm).
 */
function avoidBlackout(target: Date): Date {
  const remaining = msUntilBlackoutEnds(target);
  return remaining > 0 ? new Date(target.getTime() + remaining) : target;
}

/**
 * I-schedule ang susunod na hourly run. Kapag walang ibinigay na `target`,
 * ang susunod na buong oras ang gagamitin.
 *
 * Pare-pareho ang taskId kaya pinapalitan lang nito ang dating naka-schedule
 * na alarm — hindi ito nag-iipon ng duplicate.
 */
export function scheduleNextRun(target?: Date): void {
  const now = new Date();
  const runAt = avoidBlackout(target ?? nextTopOfHour(now));
  const delay = Math.max(MIN_DELAY_MS, Math.round(runAt.getTime() - now.getTime()));

  BackgroundFetch.scheduleTask({
    taskId: HOURLY_TASK_ID,
    delay, // ms hanggang sa susunod na run
    periodic: false, // one-off lang — kami mismo ang mag-re-reschedule
    forceAlarmManager: true, // mas malapit sa exact na oras (Android)
    stopOnTerminate: false, // tumuloy kahit na-swipe away ang app
    startOnBoot: true, // ibalik ang schedule pagka-reboot ng device
    enableHeadless: true, // pwede tumakbo kahit walang UI
  });

  console.log(
    `[HourlyCycle] Naka-schedule ang susunod na run sa ${runAt.toLocaleString()} ` +
      `(${(delay / 1000 / 60).toFixed(1)} minuto mula ngayon)`
  );
}

/**
 * Ang buong kada-oras na trabaho: kolektahin ang usage, i-store sa local DB,
 * tapos agad i-send sa API ang lahat ng hindi pa naipapadala.
 *
 * MAHALAGA: laging may nase-schedule na susunod na run sa `finally`. Kahit
 * mag-error ang collection o ang sync, hindi mapuputol ang chain.
 */
async function runHourlyCycle(trigger: string): Promise<void> {
  console.log('[HourlyCycle] Tumakbo ang cycle:', trigger);

  // Kapag naka-skip dahil sa backup window, dito natin itatakda ang oras
  // ng balik — ang mismong katapusan ng window, hindi pa ang susunod na :00.
  let resumeAt: Date | undefined;

  try {
    // Iisang `now` lang ang ginagamit sa dalawang tanong (nasa window ba
    // tayo? kailan ito matatapos?) para hindi sila mag-disagree kapag
    // tumawid ang orasan sa gitna ng dalawang tawag.
    const now = new Date();

    if (isInBlackoutWindow(now)) {
      resumeAt = new Date(now.getTime() + msUntilBlackoutEnds(now));
      console.log(
        '[HourlyCycle] Oras ng system backup — laktawan muna ang collect at sync. ' +
          `Babalik sa ${resumeAt.toLocaleTimeString()}.`
      );
      return;
    }

    const collection = await collectAndStoreUsage();

    if (collection.success) {
      console.log(
        `[HourlyCycle] Na-store: ${collection.recordCount} records.`
      );
    } else {
      console.warn('[HourlyCycle] Nabigo ang collection:', collection.reason);
    }

    // Kahit nabigo ang collection, ipadala pa rin ang mga naunang naipong
    // record — baka permission lang ang problema, hindi ang network.
    const sync = await syncPendingRecords();

    if (sync.success) {
      console.log(
        `[HourlyCycle] Tapos ang sync. Naipadala: ${sync.sentCount}, nabigo: ${sync.failedCount}`
      );
    } else {
      console.warn('[HourlyCycle] May problema sa sync:', sync.reason);
    }
  } catch (error) {
    console.warn('[HourlyCycle] Hindi inaasahang error sa cycle:', error);
  } finally {
    scheduleNextRun(resumeAt);
  }
}

/**
 * Ang default periodic fetch ang nagsisilbing watchdog. Hindi siya
 * kumokolekta kada fire — tinitingnan lang niya kung may na-miss tayong
 * hourly run, at sinisigurong may nakatakdang susunod na alarm.
 *
 * Ito ang sumasalo kapag napatay ng OS/battery optimizer ang alarm chain,
 * o kapag matagal na naka-off ang phone.
 */
async function runWatchdog(): Promise<void> {
  let overdue = true;

  try {
    const lastEnd = await getLastCollectionEndTime();
    overdue = lastEnd === null || Date.now() - lastEnd >= CATCHUP_THRESHOLD_MS;

    console.log(
      '[Watchdog] Huling collection:',
      lastEnd ? new Date(lastEnd).toLocaleString() : 'wala pa',
      overdue ? '→ may na-miss, mag-catch-up' : '→ updated pa, i-re-arm lang'
    );
  } catch (error) {
    // Kung hindi mabasa ang DB, mas ligtas nang tumakbo kaysa lumaktaw.
    console.warn('[Watchdog] Hindi mabasa ang huling collection:', error);
  }

  if (overdue) {
    // Nag-se-schedule na rin ito ng susunod na run.
    await runHourlyCycle('watchdog catch-up');
  } else {
    scheduleNextRun();
  }
}

/**
 * Kanselahin ang lumang 4-hour sync chain. Hiwalay at may sariling try/catch
 * dahil hindi ito dapat makapigil sa pag-arm ng hourly chain.
 */
async function cancelLegacySyncTask(): Promise<void> {
  try {
    await BackgroundFetch.stop(LEGACY_SYNC_TASK_ID);
  } catch (error) {
    console.warn(
      '[BackgroundTask] Hindi ma-cancel ang lumang sync task (ok lang):',
      error
    );
  }
}

/**
 * Isang routing point para pareho ang ginagawa ng foreground handler at ng
 * headless handler — kung ano man ang task na nag-fire.
 */
async function handleTask(taskId: string, source: string): Promise<void> {
  if (taskId === HOURLY_TASK_ID) {
    await runHourlyCycle(source);
  } else if (taskId === LEGACY_SYNC_TASK_ID) {
    // Natirang alarm mula sa lumang bersyon: patakbuhin na lang ang cycle,
    // tapos kanselahin na para hindi na ito umulit pa.
    await runHourlyCycle(`${source} (legacy sync task)`);
    await cancelLegacySyncTask();
  } else {
    await runWatchdog();
  }
}

/**
 * I-configure at i-start ang background scheduling.
 * Tawagin ito ONCE sa app startup (ginagawa ito ng App.tsx sa useEffect).
 */
export async function configureBackgroundTask(): Promise<void> {
  await BackgroundFetch.configure(
    {
      minimumFetchInterval: WATCHDOG_INTERVAL_MINUTES, // watchdog lang, hindi main schedule
      stopOnTerminate: false, // patuloy tumatakbo kahit na-swipe away ang app
      startOnBoot: true, // mag-restart ang scheduling pagka-reboot ng device
      enableHeadless: true, // payagan tumakbo kahit walang UI/foreground app
      requiresCharging: false,
      requiresDeviceIdle: false,
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
    },
    async (taskId: string) => {
      console.log('[BackgroundTask] Nag-fire ang task:', taskId);
      try {
        await handleTask(taskId, 'foreground/background');
      } finally {
        // Laging kailangang tapusin ang task, kahit may error — kung hindi,
        // ituturing ng OS na "misbehaving" ang app at babawasan ang oras
        // na ibibigay nito sa atin sa background.
        BackgroundFetch.finish(taskId);
      }
    },
    (taskId: string) => {
      // Tatawagin ito kung na-timeout ang task (hindi natapos sa oras).
      // Mag-re-arm pa rin tayo para hindi mamatay ang chain.
      console.warn('[BackgroundTask] Na-timeout ang task:', taskId);
      scheduleNextRun();
      BackgroundFetch.finish(taskId);
    }
  );

  // Simulan ang watchdog fetch (JobScheduler — nabubuhay ito pagka-reboot).
  await BackgroundFetch.start();

  // Kanselahin ang lumang 4-hour sync chain, kung meron pa mula sa dating
  // bersyon ng app.
  await cancelLegacySyncTask();

  // Simulan (o i-realign) ang hourly chain.
  scheduleNextRun();
}

/**
 * Optional: manual na pagtigil sa background scheduling
 * (hal. kung may "disable background collection" toggle sa Settings ng app)
 */
export async function stopBackgroundTask(): Promise<void> {
  await BackgroundFetch.stop();
  await BackgroundFetch.stop(HOURLY_TASK_ID);
  await BackgroundFetch.stop(LEGACY_SYNC_TASK_ID);
}

/**
 * Headless task handler — kailangan ito para tumakbo ang background fetch
 * kahit na fully closed/terminated na ang app (hindi lang backgrounded).
 * Ire-register ito sa index.js, HIWALAY sa configureBackgroundTask().
 */
export async function headlessTask(event: {
  taskId: string;
  timeout?: boolean;
}): Promise<void> {
  const { taskId, timeout } = event;

  if (timeout) {
    // Malapit nang bawiin ng OS ang headless slot — mag-re-arm at umalis agad.
    console.warn('[BackgroundTask][Headless] Na-timeout ang task:', taskId);
    scheduleNextRun();
    BackgroundFetch.finish(taskId);
    return;
  }

  console.log('[BackgroundTask][Headless] Nag-fire ang task:', taskId);

  try {
    await handleTask(taskId, 'headless');
  } finally {
    BackgroundFetch.finish(taskId);
  }
}
