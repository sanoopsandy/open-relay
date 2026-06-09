import fs from 'fs';
import path from 'path';
import os from 'os';
import type { DestinationStream } from 'pino';
import type { WebContents } from 'electron';
import type { LogLine } from '../ipc/types';
import { getLogPath } from './index';

const PINO_LEVEL_NUMBERS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function normalizeLogLine(raw: Record<string, unknown>): LogLine {
  let level = raw.level;
  if (typeof level === 'string') {
    level = PINO_LEVEL_NUMBERS[level] ?? 30;
  } else if (typeof level !== 'number') {
    level = 30;
  }

  const time =
    typeof raw.time === 'number'
      ? raw.time
      : typeof raw.time === 'string'
        ? Date.parse(raw.time)
        : Date.now();

  const category =
    typeof raw.category === 'string'
      ? raw.category
      : typeof raw.msg === 'object' && raw.msg !== null
        ? ''
        : '';

  const msg =
    typeof raw.msg === 'string'
      ? raw.msg
      : typeof raw.message === 'string'
        ? raw.message
        : JSON.stringify(raw.msg ?? raw);

  return { ...raw, level: level as number, time, category, msg };
}

const LOG_DIR = path.join(os.homedir(), '.harness', 'logs');
const BUFFER_SIZE = 500;

class LogViewer {
  private watcher: fs.FSWatcher | null = null;
  private subscribers = new Set<WebContents>();
  private buffer: LogLine[] = [];
  private fd: number | null = null;
  private position = 0;
  private currentFile = '';
  /** When true, logs reach UI via createBroadcastStream(); skip file tailing. */
  private liveBroadcast = false;

  enableLiveBroadcast(): void {
    this.liveBroadcast = true;
  }

  /** Pino destination: parse each NDJSON line and push to UI subscribers immediately. */
  createBroadcastStream(): DestinationStream {
    const viewer = this;
    let partial = '';
    return {
      write(chunk: string | Buffer) {
        partial += chunk.toString();
        const parts = partial.split('\n');
        partial = parts.pop() ?? '';
        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            viewer.ingest(JSON.parse(line) as Record<string, unknown>);
          } catch {
            viewer.ingest({ level: 30, time: Date.now(), category: 'main', msg: line });
          }
        }
      },
    };
  }

  ingest(raw: Record<string, unknown>): void {
    const line = normalizeLogLine(raw);
    this.addToBuffer(line);
    this.broadcast(line);
  }

  startStreaming(webContents: WebContents): void {
    this.subscribers.add(webContents);

    // Send existing buffer to new subscriber
    for (const line of this.buffer) {
      if (!webContents.isDestroyed()) {
        webContents.send('logs:line', line);
      }
    }

    // Start watcher if not already running
    if (!this.watcher) {
      this.startWatcher();
    }
  }

  stopStreaming(webContents: WebContents): void {
    this.subscribers.delete(webContents);

    if (this.subscribers.size === 0) {
      this.stopWatcher();
    }
  }

  private startWatcher(): void {
    const logFile = getLogPath();
    this.currentFile = logFile;

    // Ensure log dir exists
    fs.mkdirSync(LOG_DIR, { recursive: true });

    // Open file for reading from end
    if (fs.existsSync(logFile)) {
      this.fd = fs.openSync(logFile, 'r');
      this.position = fs.fstatSync(this.fd).size;
    }

    const watchDir = path.dirname(logFile);

    try {
      this.watcher = fs.watch(watchDir, { persistent: false }, (_event, filename) => {
        if (filename && filename === path.basename(logFile)) {
          this.readNewLines();
        }
      });
    } catch {
      // If watch fails (e.g. no log file yet), poll every 2 seconds
      const interval = setInterval(() => {
        if (this.subscribers.size === 0) {
          clearInterval(interval);
          return;
        }
        this.readNewLines();
      }, 2000);
    }
  }

  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.position = 0;
  }

  private readNewLines(): void {
    if (this.liveBroadcast) return;

    const logFile = this.currentFile || getLogPath();

    if (!fs.existsSync(logFile)) return;

    try {
      if (this.fd === null) {
        this.fd = fs.openSync(logFile, 'r');
        this.position = 0;
      }

      const stat = fs.fstatSync(this.fd);

      // Handle log rotation (file shrunk)
      if (stat.size < this.position) {
        fs.closeSync(this.fd);
        this.fd = fs.openSync(logFile, 'r');
        this.position = 0;
      }

      if (stat.size === this.position) return;

      const chunkSize = stat.size - this.position;
      const buf = Buffer.alloc(chunkSize);
      fs.readSync(this.fd, buf, 0, chunkSize, this.position);
      this.position += chunkSize;

      const text = buf.toString('utf8');
      const lines = text.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          this.ingest(JSON.parse(line) as Record<string, unknown>);
        } catch {
          this.ingest({ level: 30, time: Date.now(), category: 'main', msg: line });
        }
      }
    } catch {
      // Swallow read errors silently
    }
  }

  private addToBuffer(line: LogLine): void {
    this.buffer.push(line);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  private broadcast(line: LogLine): void {
    for (const wc of this.subscribers) {
      if (wc.isDestroyed()) {
        this.subscribers.delete(wc);
      } else {
        wc.send('logs:line', line);
      }
    }
  }

  getBuffer(): LogLine[] {
    return [...this.buffer];
  }
}

export const logViewer = new LogViewer();
