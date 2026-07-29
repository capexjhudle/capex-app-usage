import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { getUniqueDeviceId } from '../native/DeviceInfoModule';
import { saveUserProfile } from '../database/sqlite';

interface RegistrationScreenProps {
  onRegistered: () => void;
}

export default function RegistrationScreen({ onRegistered }: RegistrationScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loadingDeviceId, setLoadingDeviceId] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Kunin ang device ID sa background pagka-mount ng screen,
  // hindi na kailangang i-type ng user
  useEffect(() => {
    (async () => {
      try {
        const id = await getUniqueDeviceId();
        setDeviceId(id);
      } catch (error) {
        console.error('[RegistrationScreen] Hindi makuha ang device ID:', error);
        Alert.alert(
          'Error',
          'Hindi makuha ang device identifier. Subukan ulit i-restart ang app.'
        );
      } finally {
        setLoadingDeviceId(false);
      }
    })();
  }, []);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPhone) {
      Alert.alert('Kulang na Impormasyon', 'Pakisagutan lahat ng fields.');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      Alert.alert('Invalid na Email', 'Pakilagay ang tamang email address.');
      return;
    }

    if (!deviceId) {
      Alert.alert('Error', 'Hindi pa handa ang device identifier. Subukan ulit.');
      return;
    }

    setSubmitting(true);
    try {
      await saveUserProfile(trimmedName, trimmedEmail, trimmedPhone, deviceId);
      onRegistered();
    } catch (error) {
      console.error('[RegistrationScreen] Hindi na-save ang profile:', error);
      Alert.alert('Error', 'May problema sa pag-save. Subukan ulit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Complete your Profile</Text>
      <Text style={styles.subtitle}>
        This is only required in certain cases. The device identifier will be retrieved automatically.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Full Name"
        placeholderTextColor="#9ca3af"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <TextInput
        style={styles.input}
        placeholder="Email Address"
        placeholderTextColor="#9ca3af"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Mobile Number"
        placeholderTextColor="#9ca3af"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />

      <View style={styles.deviceIdRow}>
        {loadingDeviceId ? (
          <>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.deviceIdText}>Kinukuha ang device ID...</Text>
          </>
        ) : (
          <Text style={styles.deviceIdText}>
            Device ID: {deviceId ?? 'Hindi makuha'}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.button, (submitting || loadingDeviceId) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting || loadingDeviceId}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  deviceIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  deviceIdText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});