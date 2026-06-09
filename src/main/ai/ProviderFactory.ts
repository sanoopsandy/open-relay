import type { HarnessConfig } from '../ipc/types';
import type { AIProvider } from './AIProvider';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { OpenAIProvider, GroqProvider } from './providers/OpenAIProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { configManager } from '../config/ConfigManager';
import { log } from '../logger';

// ─── ProviderFactory ──────────────────────────────────────────────────────────

class ProviderFactory {
  private cache = new Map<string, AIProvider>();

  getProvider(config: HarnessConfig): AIProvider {
    const key = `chat:${config.ai.provider}:${config.ai.model}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const provider = this.instantiateChat(config);
    this.cache.set(key, provider);
    log.api.info({ provider: config.ai.provider, model: config.ai.model }, 'Chat provider initialized');
    return provider;
  }

  getEmbeddingProvider(config: HarnessConfig): AIProvider {
    const key = `embed:${config.ai.embeddingProvider}:${config.ai.embeddingModel}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const provider = this.instantiateEmbedding(config);
    this.cache.set(key, provider);
    log.api.info(
      { provider: config.ai.embeddingProvider, model: config.ai.embeddingModel },
      'Embedding provider initialized'
    );
    return provider;
  }

  reinitialize(config: HarnessConfig): void {
    this.cache.clear();
    log.api.info('Provider cache cleared — re-initializing');
    this.getProvider(config);
  }

  private instantiateChat(config: HarnessConfig): AIProvider {
    const { provider, apiKeyCiphertext, model, ollama, customEndpoint } = config.ai;

    switch (provider) {
      case 'claude': {
        const apiKey = configManager.decryptKey(apiKeyCiphertext);
        return new ClaudeProvider(apiKey, model);
      }
      case 'openai': {
        const apiKey = configManager.decryptKey(apiKeyCiphertext);
        return new OpenAIProvider(apiKey, model, customEndpoint ?? undefined);
      }
      case 'groq': {
        const apiKey = configManager.decryptKey(apiKeyCiphertext);
        return new GroqProvider(apiKey, model);
      }
      case 'ollama': {
        return new OllamaProvider(ollama.baseUrl, ollama.chatModel ?? undefined);
      }
      case 'gemini': {
        // Gemini uses OpenAI-compatible endpoint
        const apiKey = configManager.decryptKey(apiKeyCiphertext);
        return new OpenAIProvider(
          apiKey,
          model,
          'https://generativelanguage.googleapis.com/v1beta/openai'
        );
      }
      default: {
        log.api.warn({ provider }, 'Unknown provider — falling back to Claude');
        const apiKey = configManager.decryptKey(apiKeyCiphertext);
        return new ClaudeProvider(apiKey, model);
      }
    }
  }

  private instantiateEmbedding(config: HarnessConfig): AIProvider {
    const { embeddingProvider, embeddingApiKeyCiphertext, embeddingModel, ollama } = config.ai;

    switch (embeddingProvider) {
      case 'openai': {
        const apiKey = embeddingApiKeyCiphertext
          ? configManager.decryptKey(embeddingApiKeyCiphertext)
          : configManager.decryptKey(config.ai.apiKeyCiphertext);
        return new OpenAIProvider(apiKey, embeddingModel);
      }
      case 'ollama': {
        return new OllamaProvider(ollama.baseUrl, ollama.embeddingModel);
      }
      case 'voyage': {
        // Voyage uses OpenAI-compatible interface
        const apiKey = embeddingApiKeyCiphertext
          ? configManager.decryptKey(embeddingApiKeyCiphertext)
          : '';
        return new OpenAIProvider(apiKey, embeddingModel, 'https://api.voyageai.com/v1');
      }
      default: {
        const apiKey = configManager.decryptKey(config.ai.apiKeyCiphertext);
        return new OpenAIProvider(apiKey, embeddingModel);
      }
    }
  }
}

export const providerFactory = new ProviderFactory();
