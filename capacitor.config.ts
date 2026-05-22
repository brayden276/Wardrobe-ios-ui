import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.wardrobe.app',
  appName: 'Wardrobe AI',
  webDir: 'www',
  plugins: {
    Keyboard: {
      resize: 'body',
      style: 'LIGHT'
    }
  }
};

export default config;
