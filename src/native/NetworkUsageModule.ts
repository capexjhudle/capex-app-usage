import { NativeModules } from 'react-native';

/**
 * Type definition para sa isang usage entry na galing sa native module
 */
export interface NetworkUsageEntry {
  packageName: string;
  uid: number;
  rxBytes: number;
  txBytes: number;
  timestamp: number;
  type: 'wifi' | 'data';
  versionName: string;
  versionCode: number;
}

/**
 * Sagot ng getAppVersion(). Kapag `installed: false`, wala ang app sa
 * device o hindi ito nakikita ng package visibility rules ng Android 11+.
 */
export interface AppVersionInfo {
  installed: boolean;
  packageName: string;
  versionName?: string;
  versionCode?: number;
  appName?: string;
}

/**
 * Interface na tumutugma sa mga methods na nilagay natin sa
 * NetworkUsageModule.kt (dapat magkatugma ang pangalan at parameters)
 */
interface NetworkUsageModuleInterface {
  getUsageStats(startTime: number, endTime: number): Promise<NetworkUsageEntry[]>;
  getAppVersion(packageName: string): Promise<AppVersionInfo>;
  hasUsageAccessPermission(): Promise<boolean>;
  openUsageAccessSettings(): void;
}

// Kunin ang native module base sa pangalan na ibinigay sa getName() sa Kotlin
const { NetworkUsageModule } = NativeModules as {
  NetworkUsageModule: NetworkUsageModuleInterface;
};

if (!NetworkUsageModule) {
  console.warn(
    'NetworkUsageModule ay hindi available. ' +
      'Siguraduhing naka-link ito at Android lang ang platform.'
  );
}

/**
 * Kumuha ng network usage stats sa pagitan ng startTime at endTime
 * @param startTime - Unix timestamp (milliseconds)
 * @param endTime - Unix timestamp (milliseconds)
 */
export async function getUsageStats(
  startTime: number,
  endTime: number
): Promise<NetworkUsageEntry[]> {
  if (!NetworkUsageModule) {
    throw new Error('NetworkUsageModule ay hindi available sa platform na ito.');
  }
  return NetworkUsageModule.getUsageStats(startTime, endTime);
}

/**
 * Kunin ang version ng isang naka-install na app (hal. 'com.cis3mobileapp.app').
 * Hindi ito nagta-throw kapag wala ang app — { installed: false } ang balik.
 */
export async function getAppVersion(
  packageName: string
): Promise<AppVersionInfo> {
  if (!NetworkUsageModule) {
    return { installed: false, packageName };
  }
  return NetworkUsageModule.getAppVersion(packageName);
}

/**
 * I-check kung granted na ang Usage Access permission
 */
export async function hasUsageAccessPermission(): Promise<boolean> {
  if (!NetworkUsageModule) {
    return false;
  }
  return NetworkUsageModule.hasUsageAccessPermission();
}

/**
 * Buksan ang Settings > Usage Access screen para payagan ng user
 * ang permission (dahil hindi ito normal runtime permission)
 */
export function openUsageAccessSettings(): void {
  if (!NetworkUsageModule) {
    return;
  }
  NetworkUsageModule.openUsageAccessSettings();
}

export default {
  getUsageStats,
  getAppVersion,
  hasUsageAccessPermission,
  openUsageAccessSettings,
};