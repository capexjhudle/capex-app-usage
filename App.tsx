/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { useEffect, useState, useCallback } from 'react';
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
// import { initDatabase, getAllRecords, UsageQueueRow } from './src/database/sqlite';
import { initDatabase, getAllRecords, UsageQueueRow } from './src/database/sqlite';
import { configureBackgroundTask } from './src/background/BackgroundTask';
import { collectAndStoreUsage } from './src/services/UsageCollector';
import {
  hasUsageAccessPermission,
  openUsageAccessSettings,
} from './src/native/NetworkUsageModule';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    initDatabase();
    configureBackgroundTask();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  const [records, setRecords] = useState<UsageQueueRow[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string>('');

  // I-refresh ang listahan mula sa SQLite
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

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.button} onPress={handleManualCollect}>
          <Text style={styles.buttonText}>I-collect Ngayon</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonSecondary} onPress={loadRecords}>
          <Text style={styles.buttonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.subtitle}>
        Naka-save na records ({records.length})
      </Text>

      <FlatList
        data={records}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.recordItem}>
            <Text style={styles.recordMeta}>
              #{item.id} • {new Date(item.collected_at).toLocaleString()} •{' '}
              {item.sent ? 'Sent' : 'Not sent'}
            </Text>
            <Text style={styles.recordPayload} numberOfLines={3}>
              {item.payload}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Wala pang naka-save na data.</Text>
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
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  recordMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  recordPayload: {
    fontSize: 12,
    color: '#111827',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    marginTop: 24,
  },
});

export default App;