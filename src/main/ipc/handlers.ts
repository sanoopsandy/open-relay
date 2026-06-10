import { ipcMain, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { getMimeType } from '../documents/DocumentProcessor';
import type { HarnessConfig, DeepPartial, CreateSchedulerDto } from './types';
import type { TestConnectionResult } from '../../shared/types';
import { configManager } from '../config/ConfigManager';
import { agentRunner } from '../agent/AgentRunner';
import { commandRegistry } from '../commands/CommandRegistry';
import { dispatch } from '../commands/CommandDispatcher';
import { parse as parseCommand } from '../commands/CommandParser';
import { logViewer } from '../logger/LogViewer';
import { getLogPath } from '../logger';
import { onboardingWizard } from '../onboarding/OnboardingWizard';
import { providerFactory } from '../ai/ProviderFactory';
import { memoryRepo } from '../db/repositories/MemoryRepo';
import { artifactRepo } from '../db/repositories/ArtifactRepo';
import { usageRepo } from '../db/repositories/UsageRepo';
import { schedulerRepo } from '../db/repositories/SchedulerRepo';
import { schedulerRunRepo } from '../db/repositories/SchedulerRunRepo';
import { skillRegistry } from '../skills/SkillRegistry';
import { schedulerService } from '../scheduler/SchedulerService';
import { SlackReader } from '../scheduler/SlackReader';
import { log } from '../logger';

export function registerHandlers(mainWindow: BrowserWindow): void {
  const wc = mainWindow.webContents;

  // ── Config ──────────────────────────────────────────────────────────────────

  ipcMain.handle('config:load', async () => {
    return configManager.load();
  });

  ipcMain.handle('config:save', async (_event, config: HarnessConfig) => {
    await configManager.save(config);
    providerFactory.reinitialize(config);
  });

  ipcMain.handle('config:patch', async (_event, partial: DeepPartial<HarnessConfig>) => {
    const merged = await configManager.patch(partial);
    providerFactory.reinitialize(merged);
    return merged;
  });

  // ── AI connection test ───────────────────────────────────────────────────────

  ipcMain.handle(
    'ai:testConnection',
    async (_event, provider: HarnessConfig['ai']['provider'], apiKey: string) => {
      return onboardingWizard.validateApiKey(provider, apiKey);
    }
  );

  // ── Conversations ────────────────────────────────────────────────────────────

  ipcMain.handle('chat:createConversation', async (_event, systemPrompt?: string) => {
    return await agentRunner.createConversation(systemPrompt);
  });

  ipcMain.handle(
    'chat:sendMessage',
    async (event, conversationId: string, message: string, attachmentPaths?: string[]) => {
      await agentRunner.sendMessage(conversationId, message, event.sender, attachmentPaths);
    }
  );

  ipcMain.handle('chat:getConversation', async (_event, conversationId: string) => {
    const { conversationRepo } = await import('../db/repositories/ConversationRepo');
    return conversationRepo.findById(conversationId);
  });

  ipcMain.handle('chat:listConversations', async () => {
    return agentRunner.listConversations();
  });

  ipcMain.handle('chat:deleteConversation', async (_event, conversationId: string) => {
    agentRunner.deleteConversation(conversationId);
  });

  // ── Commands ─────────────────────────────────────────────────────────────────

  ipcMain.handle('commands:list', async () => {
    return commandRegistry.list();
  });

  ipcMain.handle('commands:search', async (_event, query: string) => {
    return commandRegistry.search(query);
  });

  ipcMain.handle('commands:resolve', async (_event, input: string) => {
    const parsed = parseCommand(input);
    if (!parsed) return null;
    const command = commandRegistry.findByTrigger(parsed.trigger);
    if (!command) return null;
    return { commandId: command.id, args: parsed.args };
  });

  ipcMain.handle('commands:dispatch', async (_event, commandId: string, args?: string, conversationId?: string) => {
    await dispatch(commandId, args ?? '', wc, conversationId);
  });

  // ── Layout ───────────────────────────────────────────────────────────────────

  ipcMain.handle('layout:set', async (_event, patch: object) => {
    // Renderer already has this state; persist only (no layout:changed echo — that caused a save loop)
    await configManager.patch({ layout: patch as DeepPartial<HarnessConfig['layout']> });
  });

  // ── Onboarding ───────────────────────────────────────────────────────────────
  // Note: onboarding:validateKey and onboarding:listOllamaModels are registered
  // inside openOnboardingWindow() and removed when that window closes.

  // ── Logs ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('logs:startStreaming', async (event) => {
    logViewer.startStreaming(event.sender);
  });

  ipcMain.handle('logs:stopStreaming', async (event) => {
    logViewer.stopStreaming(event.sender);
  });

  ipcMain.handle('logs:getPath', async () => {
    return getLogPath();
  });

  // ── Memory ───────────────────────────────────────────────────────────────────

  ipcMain.handle('memory:add', async (event, dto: { theme: string; content: string; source?: string }) => {
    const item = memoryRepo.insert(dto.theme, dto.content, dto.source);
    if (!event.sender.isDestroyed()) {
      event.sender.send('memory:itemAdded', item);
    }
    return item;
  });

  ipcMain.handle('memory:listThemes', async () => {
    return memoryRepo.listThemes();
  });

  ipcMain.handle('memory:getByTheme', async (_event, theme: string) => {
    return memoryRepo.getByTheme(theme);
  });

  ipcMain.handle('memory:deleteItem', async (_event, id: string) => {
    return memoryRepo.deleteItem(id);
  });

  ipcMain.handle('memory:search', async (_event, query: string) => {
    return memoryRepo.search(query);
  });

  // ── Dialog ───────────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'All Supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'xml'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'xml'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const fp = result.filePaths[0];
    const mimeType = getMimeType(fp);
    const isImage = mimeType.startsWith('image/');
    const dataUrl = isImage
      ? `data:${mimeType};base64,${fs.readFileSync(fp).toString('base64')}`
      : undefined;
    return {
      filePath: fp,
      name: path.basename(fp),
      mimeType,
      size: fs.statSync(fp).size,
      dataUrl,
    };
  });

  // ── Artifacts ────────────────────────────────────────────────────────────────

  ipcMain.handle('artifact:download', async (_event, { name, content }: { name: string; content: string }) => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf8');
      log.main.info({ filePath: result.filePath }, 'Artifact downloaded');
    }
  });

  ipcMain.handle('artifact:conversationsWithArtifacts', () => {
    return artifactRepo.getConversationIdsWithArtifacts();
  });

  ipcMain.handle('artifact:listByConversation', (_event, conversationId: string) => {
    return artifactRepo.getByConversation(conversationId);
  });

  // ── Schedulers ───────────────────────────────────────────────────────────────

  ipcMain.handle('scheduler:list', () => schedulerRepo.list());

  ipcMain.handle('scheduler:create', (_event, dto: CreateSchedulerDto) => {
    const scheduler = schedulerRepo.create(dto);
    schedulerService.scheduleOne(scheduler);
    return scheduler;
  });

  ipcMain.handle('scheduler:update', (_event, id: string, patch: Parameters<typeof schedulerRepo.update>[1]) => {
    const updated = schedulerRepo.update(id, patch);
    // Re-register cron if expression or active state changed
    schedulerService.stopOne(id);
    if (updated.is_active) schedulerService.scheduleOne(updated);
    return updated;
  });

  ipcMain.handle('scheduler:delete', (_event, id: string) => {
    schedulerService.stopOne(id);
    schedulerRepo.delete(id);
  });

  ipcMain.handle('scheduler:setActive', (_event, id: string, active: boolean) => {
    schedulerRepo.setActive(id, active);
    if (active) {
      const s = schedulerRepo.getById(id);
      if (s) schedulerService.scheduleOne(s);
    } else {
      schedulerService.stopOne(id);
    }
  });

  ipcMain.handle('scheduler:getMembers', (_event, schedulerId: string) => {
    return schedulerRepo.getMembers(schedulerId);
  });

  ipcMain.handle(
    'scheduler:setMembers',
    (_event, schedulerId: string, members: Array<{ slack_user_id: string; slack_display_name: string }>) => {
      schedulerRepo.setMembers(schedulerId, members);
    }
  );

  ipcMain.handle('scheduler:listRuns', (_event, schedulerId: string) => {
    return schedulerRunRepo.listByScheduler(schedulerId);
  });

  ipcMain.handle('scheduler:triggerManual', async (_event, schedulerId: string) => {
    await schedulerService.triggerManual(schedulerId);
  });

  ipcMain.handle('scheduler:getSlackChannels', async () => {
    const config = await configManager.load();
    const slackCfg = config?.integrations.slack;
    if (!slackCfg?.botTokenCiphertext) throw new Error('Slack not configured');
    const token = configManager.decryptKey(slackCfg.botTokenCiphertext);
    return new SlackReader(token).listChannels();
  });

  ipcMain.handle('scheduler:getSlackMembers', async (_e, channelId: string) => {
    const config = await configManager.load();
    const slackCfg = config?.integrations.slack;
    if (!slackCfg?.botTokenCiphertext) throw new Error('Slack not configured');
    const token = configManager.decryptKey(slackCfg.botTokenCiphertext);
    return new SlackReader(token).listChannelMembers(channelId);
  });

  // ── Skills ───────────────────────────────────────────────────────────────────

  ipcMain.handle('skills:list', () => skillRegistry.list());

  // ── Settings ─────────────────────────────────────────────────────────────────

  ipcMain.handle('settings:updateApiKey', async (
    event,
    dto: { provider: HarnessConfig['ai']['provider']; plainTextKey: string; model: string }
  ) => {
    const ciphertext = configManager.encryptKey(dto.plainTextKey);
    const updated = await configManager.patch({ ai: { provider: dto.provider, apiKeyCiphertext: ciphertext, model: dto.model } });
    providerFactory.reinitialize(updated);
    event.sender.send('config:updated', updated);
    return providerFactory.getProvider(updated).testConnection();
  });

  ipcMain.handle('settings:updateModel', async (event, dto: { model: string }) => {
    const updated = await configManager.patch({ ai: { model: dto.model } });
    providerFactory.reinitialize(updated);
    event.sender.send('config:updated', updated);
    return updated;
  });

  ipcMain.handle('settings:updateConnector', async (
    _event,
    dto: { connector: 'slack' | 'jira' | 'github'; enabled: boolean; fields: Record<string, string> }
  ) => {
    const patch: DeepPartial<HarnessConfig> = {};
    if (dto.connector === 'slack') {
      patch.integrations = {
        slack: {
          enabled: dto.enabled,
          teamId: dto.fields['teamId'] || null,
          botToken: dto.fields['botToken'] || undefined,
        } as unknown as HarnessConfig['integrations']['slack'],
      };
    } else if (dto.connector === 'jira') {
      patch.integrations = {
        jira: {
          enabled: dto.enabled,
          siteUrl: dto.fields['siteUrl'] || '',
          email: dto.fields['email'] || '',
          apiToken: dto.fields['apiToken'] || undefined,
        } as unknown as HarnessConfig['integrations']['jira'],
      };
    } else if (dto.connector === 'github') {
      patch.integrations = {
        github: {
          enabled: dto.enabled,
          pat: dto.fields['pat'] || undefined,
        } as unknown as HarnessConfig['integrations']['github'],
      };
    }
    await configManager.patchWithEncryption(patch);
  });

  ipcMain.handle('settings:updateEmbeddingKey', async (
    _event,
    dto: { provider: 'openai' | 'ollama'; plainTextKey: string }
  ) => {
    const ciphertext = dto.plainTextKey ? configManager.encryptKey(dto.plainTextKey) : '';
    const updated = await configManager.patch({
      ai: {
        embeddingProvider: dto.provider,
        embeddingApiKeyCiphertext: ciphertext || undefined,
      },
    });
    // Test the embedding
    try {
      const { OpenAIProvider } = await import('../ai/providers/OpenAIProvider');
      const { OllamaProvider } = await import('../ai/providers/OllamaProvider');
      const key = ciphertext ? configManager.decryptKey(ciphertext) : '';
      const testProvider =
        dto.provider === 'openai'
          ? new OpenAIProvider(key)
          : new OllamaProvider(updated.ai.ollama.baseUrl);
      const start = Date.now();
      await testProvider.embed('test');
      return { ok: true, latencyMs: Date.now() - start } as TestConnectionResult;
    } catch (err) {
      return { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) } as TestConnectionResult;
    }
  });

  // ── Usage ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('usage:summary', (_e, since?: number) => usageRepo.summary(since));

  ipcMain.handle('usage:byConversation', (_e, since?: number) => usageRepo.byConversation(since));

  ipcMain.handle('usage:tokensByTurn', (_e, since?: number) => usageRepo.tokensByTurn(since));

  // ── Dialog: text file ────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openTextFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['md', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return fs.readFileSync(result.filePaths[0], 'utf8');
  });

  log.main.info('IPC handlers registered');
}
