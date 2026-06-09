import { app, BrowserWindow, shell, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { initLogger, log } from './logger';
import { configManager } from './config/ConfigManager';
import { initDatabase } from './db/database';
import { providerFactory } from './ai/ProviderFactory';
import { registerHandlers } from './ipc/handlers';
import { openOnboardingWindow } from './onboarding/OnboardingWindow';
import { skillRegistry } from './skills/SkillRegistry';
import { SprintAnalysisSkill } from './skills/SprintAnalysisSkill';
import { schedulerService } from './scheduler/SchedulerService';
import { kuzuGraph } from './memory/KuzuGraph';
import { embeddingStore } from './memory/EmbeddingStore';
import { memoryRepo } from './db/repositories/MemoryRepo';
import { promotionService } from './memory/PromotionService';
import { getEmbeddingProvider } from './agent/AgentRunner';

// ─── App identity ─────────────────────────────────────────────────────────────

app.setName('Relay');

// ─── Single instance lock ─────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// ─── Main window ──────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function resolveIcon(): Electron.NativeImage | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
    path.join(process.cwd(), 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  }
  return undefined;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    backgroundColor: '#0a0a0a',
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

// ─── App startup sequence ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    // Set dock icon explicitly (dev mode — electron-builder only sets it for packaged builds)
    const dockIcon = resolveIcon();
    if (dockIcon && app.dock) {
      app.dock.setIcon(dockIcon);
    }

    // 1. Bootstrap logger with defaults (real config may update level later)
    const tempConfig = configManager.getDefaults();
    initLogger(tempConfig);
    log.main.info({ version: app.getVersion(), platform: process.platform }, 'Relay starting');

    // 2. Load persisted config
    let config = await configManager.load();

    // 3. Run onboarding wizard if no config
    if (!config) {
      log.main.info('No config found — opening onboarding wizard');
      try {
        config = await openOnboardingWindow();
      } catch (err) {
        log.main.error({ err }, 'Onboarding failed or was dismissed — quitting');
        app.quit();
        return;
      }
    }

    // 4. Re-init logger with persisted log level
    initLogger(config);

    // 5. Initialize database
    initDatabase();

    // 6. Initialize AI providers
    providerFactory.reinitialize(config);

    // 7. Create main window
    mainWindow = createMainWindow();

    // 8. Register all IPC handlers
    registerHandlers(mainWindow);

    // 9. Register skills and start scheduler
    skillRegistry.register(new SprintAnalysisSkill());
    schedulerService.initialize(mainWindow);

    // 10. Initialize Kuzu knowledge graph (non-blocking — failures disable graph features)
    kuzuGraph.init().catch((err) => log.main.warn({ err }, 'KuzuGraph init failed'));

    // 10b. Startup promotion — runs once on launch to surface substantive conversations
    void (async () => {
      try {
        const config = await configManager.load();
        if (config) {
          const ep = getEmbeddingProvider(config);
          const cp = providerFactory.getProvider(config);
          if (ep) {
            const r = await promotionService.run(ep, cp ?? undefined);
            if (r.promoted > 0) log.memory.info(r, 'Startup promotion complete');
          }
        }
      } catch (err) {
        log.memory.debug({ err }, 'Startup promotion failed — non-critical');
      }
    })();

    // 11. Daily memory cleanup + promotion cron (2am local time)
    cron.schedule('0 2 * * *', async () => {
      log.memory.info('Daily memory cleanup starting');
      try {
        const prunedTurns  = embeddingStore.purgeExpiredTurns();
        const prunedMemory = memoryRepo.purgeExpired();
        log.memory.info({ prunedTurns, prunedMemory }, 'Daily cleanup: expired rows purged');

        const config = await configManager.load();
        if (config) {
          const ep = getEmbeddingProvider(config);
          const cp = providerFactory.getProvider(config);
          if (ep) {
            const promotionResult = await promotionService.run(ep, cp ?? undefined);
            log.memory.info(promotionResult, 'Daily cleanup: promotion complete');
          } else {
            log.memory.debug('Daily cleanup: no embedding provider — promotion skipped');
          }
        }
      } catch (err) {
        log.main.error({ err }, 'Daily memory cleanup failed');
      }
    });
    log.main.info('Daily memory cleanup cron registered (0 2 * * *)');

    log.main.info('Startup complete');
  } catch (err) {
    console.error('Fatal startup error:', err);
    app.quit();
  }
});

// ─── macOS re-activate ────────────────────────────────────────────────────────

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (mainWindow === null) {
      configManager.load().then((config) => {
        if (config) {
          mainWindow = createMainWindow();
          registerHandlers(mainWindow);
        }
      });
    }
  }
});

// ─── Quit when all windows closed (non-macOS) ─────────────────────────────────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Second instance focus ────────────────────────────────────────────────────

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
