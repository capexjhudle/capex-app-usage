/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
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
import { initDatabase, getAllRecords, UsageQueueRow } from './src/database/sqlite';
import { configureBackgroundTask } from './src/background/BackgroundTask';
import { collectAndStoreUsage } from './src/services/UsageCollector';
import {
  hasUsageAccessPermission,
  openUsageAccessSettings,
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
  }, []);

  const checkPermission = useCallback(async () => {
    const granted = await hasUsageAccessPermission();
    setHasPermission(granted);
  }, []);

  useEffect(() => {
    checkPermission();
    loadRecords();
  }, [checkPermission, loadRecords]);

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