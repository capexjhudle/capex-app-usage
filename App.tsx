/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  initDatabase,
  getAllRecords,
  countUnsentRecords,
  getUserProfile,
  UsageQueueRow,
} from './src/database/sqlite';
import { syncPendingRecords } from './src/services/SyncService';
import { configureBackgroundTask } from './src/background/BackgroundTask';
import { collectAndStoreUsage } from './src/services/UsageCollector';
import {
  hasUsageAccessPermission,
  openUsageAccessSettings,
  getAppVersion,
} from './src/native/NetworkUsageModule';

import RegistrationScreen from './src/screens/RegistrationScreen';
import { isUserRegistered } from './src/database/sqlite';

// Threshold para sa "mataas na usage" — 100 MB
const HIGH_USAGE_THRESHOLD_BYTES = 100 * 1024 * 1024;

// Mga app na gusto lang ipakita sa UI
const TARGET_PACKAGES = [
  'com.viber.voip',
  'com.android.chrome',
  'com.google.android.apps.maps',
  'com.waze',
  'com.cis3mobileapp.app',
];

const APP_DISPLAY_NAMES: Record<string, string> = {
  'com.viber.voip': 'Viber',
  'com.android.chrome': 'Google Chrome',
  'com.google.android.apps.maps': 'Google Maps',
  'com.waze': 'Waze',
  'com.cis3mobileapp.app': 'OM Mobile App',
};

interface FormattedUsageEntry {
  packageName: string;
  uid: number;
  type: 'wifi' | 'data';
  downloadSize: string;
  uploadSize: string;
  downloadBytes: number;
  uploadBytes: number;
  timestamp: string;
  versionName?: string;
  versionCode?: number;
}

interface DisplayEntry extends FormattedUsageEntry {
  recordId: number;
  isHighUsage: boolean;
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [checkingRegistration, setCheckingRegistration] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);

  useEffect(() => {
    (async () => {
      await initDatabase();
      configureBackgroundTask();

      const registered = await isUserRegistered();
      setIsRegistered(registered);
      setCheckingRegistration(false);
    })();
  }, []);

  if (checkingRegistration) {
    // pwede ka rin maglagay ng splash/loading UI dito
    return null;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {isRegistered ? (
        <AppContent />
      ) : (
        <RegistrationScreen onRegistered={() => setIsRegistered(true)} />
      )}
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  const [records, setRecords] = useState<UsageQueueRow[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string>('');
  const [showHighUsageOnly, setShowHighUsageOnly] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // Device ID na naka-tali sa registration — ito ang ipinapadala natin
  // sa API bilang `device_id`.
  const [registeredDeviceId, setRegisteredDeviceId] = useState<string | null>(null);
  // packageName -> version string, live mula sa PackageManager. Ito ang
  // ginagamit kapag walang naka-store na version sa record (hal. lumang record).
  const [appVersions, setAppVersions] = useState<Record<string, string>>({});

  // Lahat ng records mula sa DB, pero i-filter/flatten lang yung 5 target apps
  const allDisplayEntries: DisplayEntry[] = records.flatMap((record) => {
    try {
      console.log(`Payload (Record ID: ${record.id})`);
      console.log(`Payload (Collected at: ${new Date(record.collected_at).toLocaleString()})`);

      const parsed: FormattedUsageEntry[] = JSON.parse(record.payload);

      return parsed
        .filter((entry) => TARGET_PACKAGES.includes(entry.packageName))
        .map((entry) => ({
          ...entry,
          recordId: record.id,
          isHighUsage:
            (entry.downloadBytes ?? 0) >= HIGH_USAGE_THRESHOLD_BYTES ||
            (entry.uploadBytes ?? 0) >= HIGH_USAGE_THRESHOLD_BYTES,
        }));
    } catch (error) {
      console.error(`Failed to parse payload for record ${record.id}:`, error);
      return [];
    }
  });

  // Bilang ng mga entries na 100MB pataas ang download o upload
  const highUsageCount = useMemo(
    () => allDisplayEntries.filter((entry) => entry.isHighUsage).length,
    [allDisplayEntries]
  );

  // Ipapakita depende kung naka-toggle ang "High Usage Only" filter
  const displayEntries = showHighUsageOnly
    ? allDisplayEntries.filter((entry) => entry.isHighUsage)
    : allDisplayEntries;

  const loadRecords = useCallback(async () => {
    const rows = await getAllRecords();
    setRecords(rows);
    setPendingCount(await countUnsentRecords());
  }, []);

  /**
   * Manual na pag-send ng lahat ng hindi pa naipapadalang records.
   * Pareho lang ito ng ginagawa ng scheduled sync — kasama na ang
   * pag-iwas sa oras ng system backup (12nn at 6:30pm).
   */
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setStatus('Nagsi-sync...');

    try {
      const result = await syncPendingRecords();

      if (result.reason && result.sentCount === 0 && result.failedCount === 0) {
        // Walang naipadala — hal. naka-skip dahil sa backup window,
        // o wala talagang pending.
        setStatus(result.reason);
      } else if (result.success) {
        setStatus(`Naipadala: ${result.sentCount} record(s)`);
      } else {
        setStatus(
          `Naipadala: ${result.sentCount}, nabigo: ${result.failedCount}. ${result.reason ?? ''}`
        );
      }
    } catch (error) {
      console.error('[App] Nabigo ang manual sync:', error);
      setStatus(
        error instanceof Error ? `Error: ${error.message}` : 'Hindi kilalang error sa sync.'
      );
    } finally {
      setSyncing(false);
      await loadRecords();
    }
  }, [loadRecords]);

  const checkPermission = useCallback(async () => {
    const granted = await hasUsageAccessPermission();
    setHasPermission(granted);
  }, []);

  const loadRegisteredDeviceId = useCallback(async () => {
    const profile = await getUserProfile();
    setRegisteredDeviceId(profile?.device_id ?? null);
  }, []);

  // Kunin ang version ng bawat target app diretso sa PackageManager.
  // Dito rin natin makikita kung nare-resolve nga ba ang com.cis3mobileapp.app.
  const loadAppVersions = useCallback(async () => {
    const results = await Promise.all(
      TARGET_PACKAGES.map(async (pkg) => {
        try {
          const info = await getAppVersion(pkg);
          console.log(`[AppVersion] ${pkg}:`, info);
          return [
            pkg,
            info.installed ? info.versionName || '(walang versionName)' : '',
          ] as const;
        } catch (error) {
          console.warn(`[AppVersion] Nabigo ang lookup para sa ${pkg}:`, error);
          return [pkg, ''] as const;
        }
      })
    );

    setAppVersions(Object.fromEntries(results.filter(([, v]) => v)));
  }, []);

  useEffect(() => {
    checkPermission();
    loadRecords();
    loadAppVersions();
    loadRegisteredDeviceId();
  }, [checkPermission, loadRecords, loadAppVersions, loadRegisteredDeviceId]);

  const handleManualCollect = async () => {
    setStatus('Kinokolekta...');
    const result = await collectAndStoreUsage();
    if (result.success) {
      setStatus(`Na-save: ${result.recordCount} entries`);
    } else {
      setStatus(`Error: ${result.reason}`);
    }
    await loadRecords();
    await checkPermission();
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: safeAreaInsets.top,
          paddingBottom: safeAreaInsets.bottom,
        },
      ]}
    >
      <Text style={styles.title}>Usage Data Collector</Text>

      <View style={styles.deviceIdBox}>
        <Text style={styles.deviceIdLabel}>Registered Device ID</Text>
        <Text style={styles.deviceIdValue} selectable>
          {registeredDeviceId ?? 'Wala pang naka-register'}
        </Text>
      </View>

      <View style={styles.permissionBox}>
        <Text style={styles.permissionText}>
          Usage Access:{' '}
          {hasPermission === null
            ? 'Checking...'
            : hasPermission
            ? '✅ Granted'
            : '❌ Not granted'}
        </Text>
        {!hasPermission && (
          <TouchableOpacity
            style={styles.button}
            onPress={openUsageAccessSettings}
          >
            <Text style={styles.buttonText}>Buksan ang Settings</Text>
          </TouchableOpacity>
        )}
      </View>

      {highUsageCount > 0 && (
        <View style={styles.highUsageBanner}>
          <Text style={styles.highUsageBannerText}>
            ⚠️ May {highUsageCount} entry(ies) na 100MB pataas ang download o upload
          </Text>
        </View>
      )}

      <View style={styles.actionsRow}>
        {/* <TouchableOpacity style={styles.button} onPress={handleManualCollect}>
          <Text style={styles.buttonText}>I-collect Ngayon</Text>
        </TouchableOpacity> */}
        <TouchableOpacity
          style={[
            styles.button,
            (syncing || pendingCount === 0) && styles.buttonDisabled,
          ]}
          onPress={handleSync}
          disabled={syncing || pendingCount === 0}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {pendingCount > 0 ? `I-sync (${pendingCount})` : 'Walang Pending'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonSecondary} onPress={loadRecords}>
          <Text style={styles.buttonText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.buttonSecondary,
            showHighUsageOnly && styles.buttonActive,
          ]}
          onPress={() => setShowHighUsageOnly((prev) => !prev)}
        >
          <Text style={styles.buttonText}>
            {showHighUsageOnly ? '✓ High Usage Only' : 'I-filter: 100MB+'}
          </Text>
        </TouchableOpacity>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.subtitle}>
        Napiling apps ({displayEntries.length})
      </Text>

      <FlatList
        data={displayEntries}
        keyExtractor={(item, index) => `${item.recordId}-${item.packageName}-${item.type}-${index}`}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View
            style={[
              styles.recordItem,
              item.isHighUsage && styles.recordItemHighUsage,
            ]}
          >
            <View style={styles.appNameRow}>
              <Text style={styles.appName}>
                {APP_DISPLAY_NAMES[item.packageName] ?? item.packageName}
              </Text>
              {item.isHighUsage && (
                <View style={styles.highUsageBadge}>
                  <Text style={styles.highUsageBadgeText}>100MB+</Text>
                </View>
              )}
            </View>
            <Text style={styles.recordMeta}>
              {item.type === 'wifi' ? '📶 WiFi' : '📱 Mobile Data'} • {item.timestamp}
              {(() => {
                const version = item.versionName || appVersions[item.packageName];
                return version ? ` • v${version}` : '';
              })()}
            </Text>
            <View style={styles.dataRow}>
              <Text
                style={[
                  styles.recordPayload,
                  item.downloadBytes >= HIGH_USAGE_THRESHOLD_BYTES &&
                    styles.recordPayloadHighUsage,
                ]}
              >
                ⬇ Download: {item.downloadSize}
              </Text>
              <Text
                style={[
                  styles.recordPayload,
                  item.uploadBytes >= HIGH_USAGE_THRESHOLD_BYTES &&
                    styles.recordPayloadHighUsage,
                ]}
              >
                ⬆ Upload: {item.uploadSize}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {showHighUsageOnly
              ? 'Walang entries na 100MB pataas.'
              : 'Wala pang na-detect na usage para sa mga napiling apps.'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  deviceIdBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginBottom: 8,
  },
  deviceIdLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  deviceIdValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  permissionBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 14,
    marginBottom: 8,
  },
  highUsageBanner: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginBottom: 12,
  },
  highUsageBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110, // para hindi lumundag ang layout pag naging spinner
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonSecondary: {
    backgroundColor: '#6b7280',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  buttonActive: {
    backgroundColor: '#b91c1c',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  status: {
    marginTop: 8,
    fontStyle: 'italic',
    color: '#374151',
  },
  listContent: {
    paddingBottom: 24,
  },
  recordItem: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    marginBottom: 8,
  },
  recordItemHighUsage: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  appName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  highUsageBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  highUsageBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  recordMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
  },
  dataRow: {
    flexDirection: 'row',
    gap: 16,
  },
  recordPayload: {
    fontSize: 13,
    color: '#111827',
  },
  recordPayloadHighUsage: {
    fontWeight: '700',
    color: '#b91c1c',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    marginTop: 24,
  },
});

export default App;