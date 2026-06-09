import type { AIProvider } from '../ai/AIProvider';
import { log } from '../logger';

// ─── EntityExtractor ─────────────────────────────────────────────────────────
// Extracts 5–8 key concepts/entities from a text turn using a lightweight AI
// chat call. Called in a background (fire-and-forget) context after messages
// are saved — never blocks the streaming response.

export async function extractEntities(
  content: string,
  provider: AIProvider,
  model: string
): Promise<string[]> {
  const words = content.trim().split(/\s+/).length;
  if (words < 10) return [];

  try {
    const response = await provider.chat(
      [
        {
          role: 'user',
          content: `Extract 5–8 key topics, concepts, named entities, or domain terms from the text below. Return ONLY a comma-separated list, no explanation, no numbering.\n\nText:\n${content.slice(0, 1200)}`,
        },
      ],
      { model, maxTokens: 80, temperature: 0 }
    );

    return response.content
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 2 && s.length <= 80);
  } catch (err) {
    log.memory.debug({ err }, 'EntityExtractor: extraction failed');
    return [];
  }
}
