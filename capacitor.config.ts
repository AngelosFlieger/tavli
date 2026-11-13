import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.plakoto.game',
  appName: 'Plakoto',
  webDir: 'dist',
  backgroundColor: '#0b1427',
  ios: {
    backgroundColor: '#0b1427',
    contentInset: 'never',
  },
};

export default config;
