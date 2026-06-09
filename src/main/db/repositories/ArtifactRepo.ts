import { getDb } from '../database';
import { log } from '../../logger';

export interface PersistedArtifact {
  id: string;
  conversationId: string;
  messageId: string;
  name: string;
  language: string;
  content: string;
  createdAt: number;
}

class ArtifactRepo {
  insert(artifact: PersistedArtifact): void {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO artifacts
        (id, conversation_id, message_id, name, language, content, created_at)
      VALUES
        (@id, @conversationId, @messageId, @name, @language, @content, @createdAt)
    `).run(artifact);
    log.db.debug({ id: artifact.id, name: artifact.name }, 'Artifact saved');
  }

  getByConversation(conversationId: string): PersistedArtifact[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, conversation_id, message_id, name, language, content, created_at
      FROM artifacts
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId) as Array<{
      id: string; conversation_id: string; message_id: string;
      name: string; language: string; content: string; created_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      messageId: r.message_id,
      name: r.name,
      language: r.language,
      content: r.content,
      createdAt: r.created_at,
    }));
  }
}

export const artifactRepo = new ArtifactRepo();
