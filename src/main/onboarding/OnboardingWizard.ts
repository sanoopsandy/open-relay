import type { HarnessConfig } from '../ipc/types';
import { configManager } from '../config/ConfigManager';
import { OllamaProvider } from '../ai/providers/OllamaProvider';
import { ClaudeProvider } from '../ai/providers/ClaudeProvider';
import { OpenAIProvider, GroqProvider } from '../ai/providers/OpenAIProvider';
import { log } from '../logger';

export interface ValidationResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

class OnboardingWizard {
  /**
   * Test an API key for the given provider without persisting anything.
   */
  async validateApiKey(
    provider: HarnessConfig['ai']['provider'],
    apiKey: string
  ): Promise<ValidationResult> {
    try {
      switch (provider) {
        case 'claude': {
          const p = new ClaudeProvider(apiKey);
          return await p.testConnection();
        }
        case 'openai': {
          const p = new OpenAIProvider(apiKey);
          return await p.testConnection();
        }
        case 'groq': {
          const p = new GroqProvider(apiKey);
          return await p.testConnection();
        }
        case 'ollama': {
          const p = new OllamaProvider();
          return await p.testConnection();
        }
        case 'gemini': {
          const p = new OpenAIProvider(
            apiKey,
            'gemini-1.5-flash',
            'https://generativelanguage.googleapis.com/v1beta/openai'
          );
          return await p.testConnection();
        }
        default:
          return { ok: false, latencyMs: 0, error: `Unknown provider: ${provider}` };
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Encrypt the API key and write the full config to disk.
   * Called when the wizard completes.
   */
  async writeConfig(
    provider: HarnessConfig['ai']['provider'],
    apiKeyPlaintext: string,
    model: string,
    connectors?: {
      slack?: { teamId: string; botToken: string };
      jira?: { siteUrl: string; email: string; apiToken: string };
    },
    personalityPrompt?: string
  ): Promise<HarnessConfig> {
    const ciphertext = configManager.encryptKey(apiKeyPlaintext);
    const config = configManager.getDefaults(provider, ciphertext, model);

    if (personalityPrompt?.trim()) {
      config.personality = { prompt: personalityPrompt.trim() };
    }

    if (connectors?.slack?.botToken) {
      config.integrations.slack = {
        enabled: true,
        teamId: connectors.slack.teamId || null,
        botTokenCiphertext: configManager.encryptKey(connectors.slack.botToken),
      };
    }

    if (connectors?.jira?.apiToken) {
      config.integrations.jira = {
        enabled: true,
        siteUrl: connectors.jira.siteUrl,
        email: connectors.jira.email,
        apiTokenCiphertext: configManager.encryptKey(connectors.jira.apiToken),
      };
    }

    await configManager.save(config);
    log.main.info({ provider, model }, 'Onboarding config written');
    return config;
  }

  /**
   * Merge arbitrary partial config after onboarding (used for integration setup).
   */
  async patchConfig(partial: Parameters<typeof configManager.patch>[0]): Promise<HarnessConfig> {
    return configManager.patch(partial);
  }

  getDefaultConfig(
    provider: HarnessConfig['ai']['provider'] = 'claude',
    model = 'claude-sonnet-4-5'
  ): HarnessConfig {
    return configManager.getDefaults(provider, '', model);
  }

  /**
   * List models from a local Ollama instance.
   */
  async listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
    try {
      const p = new OllamaProvider(baseUrl);
      return await p.listModels();
    } catch (err) {
      log.main.warn({ err }, 'Failed to list Ollama models');
      return [];
    }
  }
}

export const onboardingWizard = new OnboardingWizard();
