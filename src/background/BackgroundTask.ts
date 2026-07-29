import BackgroundFetch from 'react-native-background-fetch';
import { collectAndStoreUsage } from '../services/UsageCollector';

// Custom task ID para sa aming "on-the-hour" scheduling (5pm, 6pm, 7pm...)
const HOURLY_TASK_ID = 'com.capexusagecollector.hourly-collect';

/**
 * Kinukwenta kung ilang milliseconds na lang bago sumapit ang
 * susunod na buong oras (hal. kung 5:23pm na ngayon, ibabalik nito
 * ang milliseconds papuntang 6:00pm)
 */
function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  return next.getTime() - now.getTime();
}

/**
 * I-schedule ang susunod na collection sa susunod na buong oras
 * (hal. 5:00, 6:00, 7:00...). Ito ay "self-scheduling" — kada
 * matapos ang isang run, ito mismo ang mag-se-set ng susunod.
 */
export function scheduleNextHourlyCollection(): void {
  const delay = msUntilNextHour();

  BackgroundFetch.scheduleTask({
    taskId: HOURLY_TASK_ID,
    delay, // ms hanggang susunod na :00
    periodic: false, // one-off lang — kami mismo ang mag-re-reschedule
    forceAlarmManager: true, // mas malapit sa exact na oras (Android)
    stopOnTerminate: false, // tumuloy kahit na-swipe away ang app
    enableHeadless: true, // pwede tumakbo kahit walang UI
  });

  console.log(
    `[HourlyCollect] Naka-schedule sa loob ng ${(delay / 1000 / 60).toFixed(1)} minuto`
  );
}

/**
 * Ang aktwal na gagawin kapag tumakbo ang scheduled "on-the-hour" task.
 * Kolektahin ang data, tapos agad i-schedule ang susunod na oras.
 */
async function runHourlyCollection(taskId: string): Promise<void> {
  console.log('[HourlyCollect] Tumakbo ang scheduled task:', taskId);

  const result = await collectAndStoreUsage();

  if (result.success) {
    console.log(
      `[HourlyCollect] Successful collection: ${result.recordCount} records na-store.`
    );
  } else {
    console.warn('[HourlyCollect] Nabigo ang collection:', result.reason);
  }

  // MAHALAGA: i-schedule agad ang susunod na oras bago matapos ang task
  // kung hindi, mahihinto ang buong chain ng "every :00" scheduling
  scheduleNextHourlyCollection();
}

/**
 * I-configure at i-start ang background fetch job.
 * Tawagin ito ONCE sa app startup (halimbawa sa loob ng App.tsx
 * gamit ang useEffect, o sa index.js bago i-register ang App).
 */
export async function configureBackgroundTask(): Promise<void> {
  await BackgroundFetch.configure(
    {
      minimumFetchInterval: 60, // fallback lang ito, hindi na main schedule
      stopOnTerminate: false, // patuloy tumatakbo kahit na-swipe away ang app
      startOnBoot: true, // mag-restart ang scheduling pagka-reboot ng device
      enableHeadless: true, // payagan tumakbo kahit walang UI/foreground app
      requiresCharging: false,
      requiresDeviceIdle: false,
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
    },
    async (taskId: string) => {
      // Ito ang tatawagin tuwing may fire na task (kahit periodic o scheduled)
      console.log('[BackgroundTask] Nag-fire ang task:', taskId);

      if (taskId === HOURLY_TASK_ID) {
        // Ito yung sarili nating "on-the-hour" schedule
        await runHourlyCollection(taskId);
      } else {
        // Default periodic fetch (fallback lang, hindi na "on-the-hour")
        const result = await collectAndStoreUsage();

        if (result.success) {
          console.log(
            `[BackgroundTask] Successful collection: ${result.recordCount} records na-store.`
          );
        } else {
          console.warn('[BackgroundTask] Nabigo ang collection:', result.reason);
        }
      }

      // MAHALAGA: laging tawagin ito para malaman ng OS na tapos na ang task
      BackgroundFetch.finish(taskId);
    },
    (taskId: string) => {
      // Tatawagin ito kung na-timeout ang task (hindi natapos sa oras)
      console.warn('[BackgroundTask] Na-timeout ang task:', taskId);
      BackgroundFetch.finish(taskId);
    }
  );

  // Simulan ang default periodic fetch (fallback lang)
  await BackgroundFetch.start();

  // Simulan ang unang "on-the-hour" schedule (5pm, 6pm, 7pm, atbp.)
  scheduleNextHourlyCollection();
}

/**
 * Optional: manual na pagtigil sa background scheduling
 * (hal. kung may "disable background collection" toggle sa Settings ng app)
 */
export async function stopBackgroundTask(): Promise<void> {
  await BackgroundFetch.stop();
  await BackgroundFetch.stop(HOURLY_TASK_ID);
}

/**
 * Headless task handler — kailangan ito para tumakbo ang background fetch
 * kahit na fully closed/terminated na ang app (hindi lang backgrounded).
 * Ire-register ito sa index.js, HIWALAY sa configureBackgroundTask().
 */
export async function headlessTask(event: { taskId: string }): Promise<void> {
  const { taskId } = event;
  console.log('[BackgroundTask][Headless] Nag-fire ang task:', taskId);

  if (taskId === HOURLY_TASK_ID) {
    await runHourlyCollection(taskId);
  } else {
    const result = await collectAndStoreUsage();

    if (result.success) {
      console.log(
        `[BackgroundTask][Headless] Successful collection: ${result.recordCount} records na-store.`
      );
    } else {
      console.warn('[BackgroundTask][Headless] Nabigo ang collection:', result.reason);
    }
  }

  BackgroundFetch.finish(taskId);
}