import { NativeModules } from 'react-native';

interface DeviceInfoModuleInterface {
  getUniqueId(): Promise<string>;
}

const { DeviceInfoModule } = NativeModules as {
  DeviceInfoModule: DeviceInfoModuleInterface;
};

if (!DeviceInfoModule) {
  console.warn(
    'DeviceInfoModule ay hindi available. ' +
      'Siguraduhing naka-link ito at Android lang ang platform.'
  );
}

/**
 * Kunin ang unique device ID (ANDROID_ID).
 * Ginagamit ito para i-tali ang isang user registration sa
 * partikular na device nang hindi kailangan ng manual login.
 */
export async function getUniqueDeviceId(): Promise<string> {
  if (!DeviceInfoModule) {
    throw new Error('DeviceInfoModule ay hindi available sa platform na ito.');
  }
  return DeviceInfoModule.getUniqueId();
}

export default { getUniqueDeviceId };