import { WebClient } from '@slack/web-api';
import type { SlackChannel, SlackUser } from '../ipc/types';
import type { RawSlackMessage } from '../skills/SkillBase';
import { log } from '../logger';

export class SlackReader {
  private client: WebClient;

  constructor(botToken: string) {
    this.client = new WebClient(botToken);
  }

  async listChannels(): Promise<SlackChannel[]> {
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
      });
      return (result.channels ?? [])
        .filter((c) => c.id && c.name)
        .map((c) => ({ id: c.id!, name: c.name! }));
    } catch (err) {
      log.api.error({ err }, 'SlackReader.listChannels failed');
      throw err;
    }
  }

  async listChannelMembers(channelId: string): Promise<SlackUser[]> {
    const userIds: string[] = [];
    try {
      let cursor: string | undefined;
      do {
        const result = await this.client.conversations.members({
          channel: channelId,
          limit: 200,
          cursor,
        });
        userIds.push(...(result.members ?? []));
        cursor = result.response_metadata?.next_cursor;
      } while (cursor);
    } catch (err) {
      log.api.error({ err, channelId }, 'SlackReader.listChannelMembers failed');
      throw err;
    }

    // Enrich user IDs with profile info; skip bots/deleted
    const users: SlackUser[] = [];
    for (const id of userIds) {
      try {
        const info = await this.client.users.info({ user: id });
        const u = info.user;
        if (!u || u.deleted || u.is_bot || u.id === 'USLACKBOT') continue;
        users.push({
          id: u.id!,
          displayName: u.profile?.display_name || u.name || u.id!,
          realName: u.real_name || u.profile?.real_name || '',
        });
      } catch {
        // skip unresolvable user
      }
    }
    return users;
  }

  async fetchMessages(channelId: string, oldest: string, latest: string): Promise<RawSlackMessage[]> {
    const messages: RawSlackMessage[] = [];

    try {
      let cursor: string | undefined;

      do {
        const result = await this.client.conversations.history({
          channel: channelId,
          oldest,
          latest,
          limit: 200,
          cursor,
        });

        const batch = result.messages ?? [];

        for (const msg of batch) {
          if (!msg.ts || !msg.text) continue;
          messages.push({
            ts: msg.ts,
            user: msg.user ?? msg.bot_id ?? 'unknown',
            text: msg.text,
            thread_ts: msg.thread_ts,
          });

          // Fetch thread replies if any
          if (msg.reply_count && msg.reply_count > 0 && msg.ts) {
            const replies = await this.fetchThreadReplies(channelId, msg.ts);
            // Skip first reply (it's the parent message we already added)
            messages.push(...replies.slice(1));
          }
        }

        cursor = result.response_metadata?.next_cursor;
      } while (cursor);
    } catch (err) {
      log.api.error({ err, channelId }, 'SlackReader.fetchMessages failed');
      throw err;
    }

    // Sort by ts ascending
    messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
    return messages;
  }

  private async fetchThreadReplies(channelId: string, threadTs: string): Promise<RawSlackMessage[]> {
    try {
      const result = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 100,
      });
      return (result.messages ?? [])
        .filter((m) => m.ts && m.text)
        .map((m) => ({
          ts: m.ts!,
          user: m.user ?? m.bot_id ?? 'unknown',
          text: m.text!,
          thread_ts: m.thread_ts,
        }));
    } catch (err) {
      log.api.warn({ err, channelId, threadTs }, 'SlackReader.fetchThreadReplies failed — skipping');
      return [];
    }
  }
}
