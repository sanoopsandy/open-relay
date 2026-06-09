import fs from 'fs';
import path from 'path';
import os from 'os';
import pino, { Logger } from 'pino';
import type { HarnessConfig } from '../ipc/types';
import { logViewer } from './LogViewer';

// ─── Paths ────────────────────────────────────────────────────────────────────

const HARNESS_DIR = path.join(os.homedir(), '.relay');
const LOG_DIR = path.join(HARNESS_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'relay.log');

// ─── State ────────────────────────────────────────────────────────────────────

let _root: Logger | null = null;
let _logPath = LOG_FILE;
let _initialized = false;

// ─── Fallback console shim (used before initLogger) ──────────────────────────

function makeConsoleShim(category: string) {
  return {
    trace: (...a: unknown[]) => console.debug(`[${category}]`, ...a),
    debug: (...a: unknown[]) => console.debug(`[${category}]`, ...a),
    info:  (...a: unknown[]) => console.info(`[${category}]`, ...a),
    warn:  (...a: unknown[]) => console.warn(`[${category}]`, ...a),
    error: (...a: unknown[]) => console.error(`[${category}]`, ...a),
    fatal: (...a: unknown[]) => console.error(`[${category}]`, ...a),
    child: () => makeConsoleShim(category),
  };
}

// ─── Child logger proxy ───────────────────────────────────────────────────────

function child(category: string): Logger {
  if (_root) return _root.child({ category }) as Logger;
  return makeConsoleShim(category) as unknown as Logger;
}

// ─── Exported log namespaces ──────────────────────────────────────────────────

export const log = {
  get agent()  { return child('agent'); },
  get memory() { return child('memory'); },
  get browser(){ return child('browser'); },
  get mcp()    { return child('mcp'); },
  get skill()  { return child('skill'); },
  get db()     { return child('db'); },
  get api()    { return child('api'); },
  get main()   { return child('main'); },
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function initLogger(config: HarnessConfig): void {
  if (_initialized) return;
  _initialized = true;

  const level = config.logging?.level ?? 'info';
  const isDev = process.env.NODE_ENV === 'development';

  let destination: pino.DestinationStream;

  if (isDev) {
    // Dev: pretty stderr + log file + live UI broadcast
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pinoPretty = require('pino-pretty');
    const prettyStream = pinoPretty({
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      destination: process.stderr,
    });
    const fileStream = pino.destination({ dest: LOG_FILE, sync: false });
    logViewer.enableLiveBroadcast();
    destination = pino.multistream([
      { stream: prettyStream },
      { stream: fileStream },
      { stream: logViewer.createBroadcastStream() },
    ]);
  } else {
    // Rolling file in production
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pinoRoll = require('pino-roll');
    destination = pinoRoll.default
      ? new pinoRoll.default(LOG_FILE, {
          frequency: 'daily',
          limit: { count: 30 },
          size: '100m',
          mkdir: true,
        })
      : pino.destination(LOG_FILE);
  }

  _root = pino(
    {
      level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(_label, number) {
          return { level: number };
        },
      },
    },
    destination
  );

  _root.info({ category: 'main' }, 'Logger initialized');
}

export function setLogLevel(level: string): void {
  if (_root) {
    _root.level = level;
  }
}

export function getLogPath(): string {
  return _logPath;
}

export function getRootLogger(): Logger | null {
  return _root;
}
