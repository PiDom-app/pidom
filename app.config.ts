import type { ExpoConfig } from 'expo/config';

const projectId = '8dcac7a4-80ab-438a-bafb-3438a24ab2d1';

const config: ExpoConfig = {
  name: 'Pidom',
  slug: 'pidom',
  owner: 'teum254s-team',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/images/icon.png',
  scheme: 'pidom',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    requireFullScreen: true,
    bundleIdentifier: 'com.pidom.app',
    infoPlist: {
      LSSupportsOpeningDocumentsInPlace: true,
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'PDF',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['com.adobe.pdf'],
        },
      ],
    },
  },
  android: {
    package: 'com.pidom.app',
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        category: ['DEFAULT', 'BROWSABLE'],
        data: [
          { scheme: 'content', mimeType: 'application/pdf' },
          { scheme: 'file', mimeType: 'application/pdf' },
        ],
      },
    ],
    permissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.DOWNLOAD_WITHOUT_NOTIFICATION',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        dark: { backgroundColor: '#000000', image: './assets/images/splash-icon-dark.png' },
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
      },
    ],
    '@react-native-google-signin/google-signin',
    'expo-secure-store',
    ['expo-sqlite', { enableFTS: true, useSQLCipher: true }],
    'expo-sharing',
    [
      'expo-notifications',
      { icon: './assets/images/android-icon-monochrome.png', color: '#6a59e8' },
    ],
    '@config-plugins/react-native-blob-util',
    '@config-plugins/react-native-pdf',
    ['expo-screen-orientation', { initialOrientation: 'DEFAULT' }],
    './plugins/with-text-measurement-fix',
  ],
  updates: {
    url: `https://u.expo.dev/${projectId}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: './certs/eas-update.pem',
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  },
  runtimeVersion: { policy: 'fingerprint' },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: { projectId },
  },
};

export default config;
