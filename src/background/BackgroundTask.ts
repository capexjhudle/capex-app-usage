import BackgroundFetch from 'react-native-background-fetch';
import { collectAndStoreUsage } from '../services/UsageCollector';

/**
 * I-configure at i-start ang background fetch job.
 * Tawagin ito ONCE sa app startup (halimbawa sa loob ng App.tsx
 * gamit ang useEffect, o sa index.js bago i-register ang App).
 *
 * Gagamit tayo ng react-native-background-fetch dahil ito ang
 * mas simple at reliable na paraan para mag-schedule ng periodic
 * background task sa Android nang hindi direktang gumagalaw sa
 * WorkManager Java/Kotlin APIs.
 */
export async function configureBackgroundTask(): Promise<void> {
  await BackgroundFetch.configure(
    {
      minimumFetchInterval: 60, // minuto — 60 = every 1 hour (pinakamababa na hinahayaan ng OS)
      stopOnTerminate: false, // patuloy tumatakbo kahit na-swipe away ang app
      startOnBoot: true, // mag-restart ang scheduling pagka-reboot ng device
      enableHeadless: true, // payagan tumakbo kahit walang UI/foreground app
      requiresCharging: false,
      requiresDeviceIdle: false,
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
    },
    async (taskId: string) => {
      // Ito ang tatakbo kada scheduled interval
      console.log('[BackgroundTask] Nag-fire ang task:', taskId);

      const result = await collectAndStoreUsage();

      if (result.success) {
        console.log(
          `[BackgroundTask] Successful collection: ${result.recordCount} records na-store.`
        );
      } else {
        console.warn('[BackgroundTask] Nabigo ang collection:', result.reason);
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

  // Simulan agad ang scheduling
  await BackgroundFetch.start();
}

/**
 * Optional: manual na pagtigil sa background scheduling
 * (hal. kung may "disable background collection" toggle sa Settings ng app)
 */
export async function stopBackgroundTask(): Promise<void> {
  await BackgroundFetch.stop();
}

/**
 * Headless task handler — kailangan ito para tumakbo ang background fetch
 * kahit na fully closed/terminated na ang app (hindi lang backgrounded).
 * Ire-register ito sa index.js, HIWALAY sa configureBackgroundTask().
 */
export async function headlessTask(event: { taskId: string }): Promise<void> {
  const { taskId } = event;
  console.log('[BackgroundTask][Headless] Nag-fire ang task:', taskId);

  const result = await collectAndStoreUsage();

  if (result.success) {
    console.log(
      `[BackgroundTask][Headless] Successful collection: ${result.recordCount} records na-store.`
    );
  } else {
    console.warn('[BackgroundTask][Headless] Nabigo ang collection:', result.reason);
  }

  BackgroundFetch.finish(taskId);
}