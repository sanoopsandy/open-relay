import fs from 'fs';
import path from 'path';
import type { ContentBlock } from '../ai/AIProvider';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
const MAX_PDF_BYTES   = 32 * 1024 * 1024;  // 32 MB

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':  return 'application/pdf';
    case '.png':  return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif':  return 'image/gif';
    case '.webp': return 'image/webp';
    case '.txt':  return 'text/plain';
    case '.md':   return 'text/markdown';
    case '.csv':  return 'text/csv';
    case '.json': return 'application/json';
    case '.js':   return 'text/javascript';
    case '.ts':   return 'text/typescript';
    case '.py':   return 'text/x-python';
    case '.html': return 'text/html';
    case '.xml':  return 'text/xml';
    default:      return 'text/plain';
  }
}

export class DocumentProcessor {
  processFile(filePath: string, mimeType: string, providerId: string): ContentBlock[] {
    const name = path.basename(filePath);
    const size = fs.statSync(filePath).size;

    if (mimeType === 'application/pdf') {
      if (size > MAX_PDF_BYTES) throw new Error(`PDF too large (${Math.round(size / 1024 / 1024)} MB > 32 MB limit): ${name}`);

      if (providerId === 'claude') {
        const data = fs.readFileSync(filePath).toString('base64');
        return [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
        }];
      }

      // Non-Claude providers: text placeholder
      return [{
        type: 'text',
        text: `[PDF attached: ${name}]\nNote: native PDF reading requires the Claude provider. Switch to Claude for full PDF support.`,
      }];
    }

    if (IMAGE_TYPES.has(mimeType)) {
      if (size > MAX_IMAGE_BYTES) throw new Error(`Image too large (${Math.round(size / 1024 / 1024)} MB > 10 MB limit): ${name}`);
      const data = fs.readFileSync(filePath).toString('base64');
      return [{
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data },
      }];
    }

    // Text-based files
    const text = fs.readFileSync(filePath, 'utf8');
    return [{ type: 'text', text: `[File: ${name}]\n${text}` }];
  }
}

export const documentProcessor = new DocumentProcessor();
