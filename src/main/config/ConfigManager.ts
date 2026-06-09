import fs from 'fs';
import path from 'path';
import os from 'os';
import { safeStorage } from 'electron';
import type { HarnessConfig, DeepPartial } from '../ipc/types';
import { log } from '../logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_VERSION = 2;
const HARNESS_DIR = path.join(os.homedir(), '.relay');
const CONFIG_FILE = path.join(HARNESS_DIR, 'config.json');

const SUB_DIRS = ['db', 'graph', 'vectors', 'skills', 'sessions', 'logs'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  for (const sub of SUB_DIRS) {
    fs.mkdirSync(path.join(HARNESS_DIR, sub), { recursive: true });
  }
}

function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    for (const key of Object.keys(source) as Array<keyof T>) {
      const srcVal = (source as T)[key];
      if (isObject(srcVal)) {
        if (!(key in (target as object))) {
          Object.assign(output, { [key]: srcVal });
        } else {
          (output as Record<string, unknown>)[key as string] = deepMerge(
            (target as Record<string, unknown>)[key as string],
            srcVal as DeepPartial<unknown>
          );
        }
      } else if (srcVal !== undefined) {
        Object.assign(output, { [key]: srcVal });
      }
    }
  }
  return output;
}

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

// ─── ConfigManager ────────────────────────────────────────────────────────────

class ConfigManager {
  // ── Crypto ──────────────────────────────────────────────────────────────────

  encryptKey(plaintext: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: base64 only (dev without keychain)
      return Buffer.from(plaintext, 'utf8').toString('base64');
    }
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  }

  decryptKey(ciphertext: string): string {
    if (!ciphertext) return '';
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return Buffer.from(ciphertext, 'base64').toString('utf8');
      }
      const buf = Buffer.from(ciphertext, 'base64');
      return safeStorage.decryptString(buf);
    } catch (err) {
      log.db.error({ err }, 'Failed to decrypt key');
      return '';
    }
  }

  // ── Disk I/O ─────────────────────────────────────────────────────────────────

  async load(): Promise<HarnessConfig | null> {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return null;
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw) as HarnessConfig;
      if (!parsed.version || parsed.version < CONFIG_VERSION) {
        log.db.warn({ version: parsed.version }, 'Config version mismatch — treating as unconfigured');
        return null;
      }
      return parsed;
    } catch (err) {
      log.db.error({ err }, 'Failed to load config');
      return null;
    }
  }

  async save(config: HarnessConfig): Promise<void> {
    ensureDirs();
    const payload = JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2);
    fs.writeFileSync(CONFIG_FILE, payload, 'utf8');
    log.db.info({ path: CONFIG_FILE }, 'Config saved');
  }

  async patch(partial: DeepPartial<HarnessConfig>): Promise<HarnessConfig> {
    const current = (await this.load()) ?? this.getDefaults();
    const merged = deepMerge(current, partial);
    if (JSON.stringify(merged) === JSON.stringify(current)) {
      return merged;
    }
    await this.save(merged);
    return merged;
  }

  // ── Defaults ─────────────────────────────────────────────────────────────────

  getDefaults(
    provider: HarnessConfig['ai']['provider'] = 'claude',
    apiKeyCiphertext = '',
    model = 'claude-sonnet-4-5'
  ): HarnessConfig {
    return {
      version: CONFIG_VERSION,
      ai: {
        provider,
        apiKeyCiphertext,
        model,
        embeddingProvider: 'openai',
        embeddingApiKeyCiphertext: undefined,
        embeddingModel: 'text-embedding-3-small',
        ollama: {
          baseUrl: 'http://localhost:11434',
          chatModel: null,
          embeddingModel: 'nomic-embed-text',
        },
        customEndpoint: null,
      },
      integrations: {
        jira: { enabled: false, siteUrl: '', apiTokenCiphertext: '', email: '' },
        github: { enabled: false, patCiphertext: null },
        slack: { enabled: false, teamId: null, botTokenCiphertext: null },
      },
      personality: {
        prompt: '',
      },
      memory: {
        ttl: {
          browsing: 60 * 60 * 24 * 7,       // 7 days in seconds
          conversation: 60 * 60 * 24 * 90,  // 90 days
          project: 60 * 60 * 24 * 365,      // 1 year
          skill: 60 * 60 * 24 * 365,
          agent_action: 60 * 60 * 24 * 30,  // 30 days
        },
      },
      layout: {
        browserPane: 'hidden',
        sidebarOpen: true,
      },
      telemetry: {
        enabled: false,
        endpoint: '',
      },
      logging: {
        level: 'info',
        remoteEndpoint: null,
      },
    };
  }

  // Patch with automatic encryption of plaintext connector credential fields.
  // Caller passes plaintext tokens; this encrypts them before persisting.
  async patchWithEncryption(partial: DeepPartial<HarnessConfig>): Promise<HarnessConfig> {
    const p = partial as Record<string, unknown>;
    const integrations = p['integrations'] as Record<string, Record<string, unknown>> | undefined;
    if (integrations) {
      if (integrations['slack']?.['botToken']) {
        integrations['slack']['botTokenCiphertext'] = this.encryptKey(integrations['slack']['botToken'] as string);
        delete integrations['slack']['botToken'];
      }
      if (integrations['jira']?.['apiToken']) {
        integrations['jira']['apiTokenCiphertext'] = this.encryptKey(integrations['jira']['apiToken'] as string);
        delete integrations['jira']['apiToken'];
      }
      if (integrations['github']?.['pat']) {
        integrations['github']['patCiphertext'] = this.encryptKey(integrations['github']['pat'] as string);
        delete integrations['github']['pat'];
      }
    }
    return this.patch(partial);
  }

  getConfigDir(): string {
    return HARNESS_DIR;
  }
}

export const configManager = new ConfigManager();
