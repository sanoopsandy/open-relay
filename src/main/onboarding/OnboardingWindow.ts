import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import type { HarnessConfig } from '../ipc/types';
import { log } from '../logger';
import { onboardingWizard } from './OnboardingWizard';

export function openOnboardingWindow(): Promise<HarnessConfig> {
  return new Promise((resolve, reject) => {
    // Register onboarding-specific handlers here because registerHandlers()
    // hasn't been called yet (it runs after this promise resolves).
    ipcMain.handle(
      'onboarding:validateKey',
      async (_event, provider: HarnessConfig['ai']['provider'], apiKey: string) => {
        return onboardingWizard.validateApiKey(provider, apiKey);
      }
    );
    ipcMain.handle('onboarding:listOllamaModels', async () => {
      return onboardingWizard.listOllamaModels();
    });

    const win = new BrowserWindow({
      width: 780,
      height: 520,
      resizable: false,
      center: true,
      show: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: '#0a0a0a',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Load the renderer — same entry point, but the renderer checks config and shows onboarding
    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?onboarding=1`);
    } else {
      win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
        query: { onboarding: '1' },
      });
    }

    win.once('ready-to-show', () => {
      win.show();
      log.main.info('Onboarding window shown');
    });

    // Listen for onboarding completion via invoke (renderer uses ipcRenderer.invoke)
    let completed = false;
    ipcMain.handle(
      'onboarding:complete',
      async (
        _event,
        dto: {
          provider: HarnessConfig['ai']['provider'];
          apiKey: string;
          model: string;
          connectors?: {
            slack?: { teamId: string; botToken: string };
            jira?: { siteUrl: string; email: string; apiToken: string };
          };
          personalityPrompt?: string;
        }
      ) => {
        if (completed) return;
        completed = true;
        // Encrypt the key and persist — renderer never touches safeStorage
        const config = await onboardingWizard.writeConfig(
          dto.provider,
          dto.apiKey,
          dto.model,
          dto.connectors,
          dto.personalityPrompt
        );
        log.main.info({ provider: dto.provider, model: dto.model }, 'Onboarding complete');
        ipcMain.removeHandler('onboarding:complete');
        win.close();
        resolve(config);
        return config;
      }
    );

    win.on('closed', () => {
      ipcMain.removeHandler('onboarding:validateKey');
      ipcMain.removeHandler('onboarding:listOllamaModels');
      if (!completed) {
        ipcMain.removeHandler('onboarding:complete');
        reject(new Error('Onboarding window closed without completing'));
      }
    });
  });
}
