import { DataUsageInfo } from '../types';

export interface InstalledAppMock {
  appName: string;
  packageName: string;
  permissions: string[];
  foregroundMinutes: number;
  isSystemApp: boolean;
  lastUsedTime: string;
  dataUsage: DataUsageInfo;
}

export const INITIAL_INSTALLED_APPS: InstalledAppMock[] = [
  {
    appName: 'Google',
    packageName: 'com.google.android.googlequicksearchbox',
    permissions: ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_CONTACTS'],
    foregroundMinutes: 2,
    isSystemApp: false,
    lastUsedTime: '18 Oct, 09:12 AM',
    dataUsage: {
      mobileBytes: 125 * 1024 * 1024, // 125 MiB
      wifiBytes: 45 * 1024 * 1024,
      available: true,
    },
  },
  {
    appName: 'Super Torch Light',
    packageName: 'com.flashlight.bright.torch',
    permissions: ['CAMERA', 'ACCESS_FINE_LOCATION', 'READ_CONTACTS'],
    foregroundMinutes: 1,
    isSystemApp: false,
    lastUsedTime: '12 Oct, 11:45 PM',
    dataUsage: {
      mobileBytes: 112 * 1024 * 1024, // Suspiciously high data for a flashlight
      wifiBytes: 0,
      available: true,
    },
  },
  {
    appName: 'Background Battery Saver',
    packageName: 'com.example.stealthtracker',
    permissions: ['ACCESS_FINE_LOCATION', 'RECORD_AUDIO', 'READ_CONTACTS'],
    foregroundMinutes: 0,
    isSystemApp: false,
    lastUsedTime: 'Never used',
    dataUsage: {
      mobileBytes: 95 * 1024 * 1024,
      wifiBytes: 15 * 1024 * 1024,
      available: true,
    },
  },
  {
    appName: 'Phone Cleaner Pro',
    packageName: 'com.cleaner.booster.fast',
    permissions: ['READ_CONTACTS', 'CAMERA'],
    foregroundMinutes: 3,
    isSystemApp: false,
    lastUsedTime: '15 Oct, 03:20 PM',
    dataUsage: {
      mobileBytes: 48 * 1024 * 1024,
      wifiBytes: 12 * 1024 * 1024,
      available: true,
    },
  },
  {
    appName: 'WhatsApp',
    packageName: 'com.whatsapp',
    permissions: ['CAMERA', 'RECORD_AUDIO', 'READ_CONTACTS'],
    foregroundMinutes: 145,
    isSystemApp: false,
    lastUsedTime: '19 Oct, 07:55 AM',
    dataUsage: {
      mobileBytes: 42 * 1024 * 1024,
      wifiBytes: 310 * 1024 * 1024,
      available: true,
    },
  },
  {
    appName: 'Instagram',
    packageName: 'com.instagram.android',
    permissions: ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION'],
    foregroundMinutes: 55,
    isSystemApp: false,
    lastUsedTime: '18 Oct, 10:30 PM',
    dataUsage: {
      mobileBytes: 88 * 1024 * 1024,
      wifiBytes: 250 * 1024 * 1024,
      available: true,
    },
  },
  {
    appName: 'Google Maps',
    packageName: 'com.google.android.apps.maps',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    foregroundMinutes: 35,
    isSystemApp: false,
    lastUsedTime: '17 Oct, 02:15 PM',
    dataUsage: {
      mobileBytes: 14 * 1024 * 1024,
      wifiBytes: 52 * 1024 * 1024,
      available: true,
    },
  },
  {
    appName: 'Camera',
    packageName: 'com.android.camera2',
    permissions: ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION'],
    foregroundMinutes: 18,
    isSystemApp: true,
    lastUsedTime: '19 Oct, 06:40 AM',
    dataUsage: {
      mobileBytes: 0,
      wifiBytes: 0,
      available: true,
    },
  },
  {
    appName: 'Phone',
    packageName: 'com.android.dialer',
    permissions: ['READ_CONTACTS', 'RECORD_AUDIO'],
    foregroundMinutes: 28,
    isSystemApp: true,
    lastUsedTime: '19 Oct, 07:10 AM',
    dataUsage: {
      mobileBytes: 120 * 1024,
      wifiBytes: 450 * 1024,
      available: true,
    },
  },
];
