import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jp.shunpei1130.nekotsubushi',
  appName: '猫つぶし',
  webDir: 'dist',
  ios: { backgroundColor: '#fff5e4', preferredContentMode: 'mobile', contentInset: 'never' },
};
export default config;
