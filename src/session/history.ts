import { createReadStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { normalizeSessionPreview } from './preview';

export interface SessionSummary {
  sessionId: string;
  mtime: number;
  /** The session's first user message. */
  preview: string;
  /** The most recent user or assistant message, when the transcript has one. */
  lastPreview?: string;
  lineCount: number;
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

function claudeProjectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeCwd(cwd));
}

/** Return the most recent `limit` jsonl sessions for the given cwd, newest first. */
export async function listRecentSessions(cwd: string, limit = 5): Promise<SessionSummary[]> {
  const dir = claudeProjectDir(cwd);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const jsonls = files.filter((f) => f.endsWith('.jsonl'));
  const withStats = await Promise.all(
    jsonls.map(async (f) => {
      const path = join(dir, f);
      try {
        const st = await stat(path);
        return { file: f, path, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const sorted = withStats
    .filter((x): x is { file: string; path: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  return Promise.all(
    sorted.map(async (entry) => {
      const sessionId = entry.file.replace(/\.jsonl$/, '');
      const { preview, lastPreview, lineCount } = await summarize(entry.path);
      return {
        sessionId,
        mtime: entry.mtime,
        preview,
        ...(lastPreview ? { lastPreview } : {}),
        lineCount,
      };
    }),
  );
}

async function summarize(
  path: string,
): Promise<{ preview: string; lastPreview?: string; lineCount: number }> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream });
  let preview = '';
  let lineCount = 0;
  // Keep the tail's raw message lines instead of parsing every entry: a long
  // session's assistant lines carry the whole context and are expensive to
  // deserialize just to read the last sentence.
  const tail: string[] = [];
  try {
    for await (const line of rl) {
      lineCount++;
      const isMessage = line.includes('"type":"user"') || line.includes('"type":"assistant"');
      if (!isMessage) continue;
      if (!preview && line.includes('"type":"user"')) {
        const text = messageText(line, 'user');
        if (text) preview = normalizeSessionPreview(text);
      }
      tail.push(line);
      if (tail.length > TAIL_MESSAGE_LINES) tail.shift();
      // reading the whole file is fine — sessions are usually under 10k lines
      if (lineCount > 20_000) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  let lastPreview: string | undefined;
  for (const line of tail) {
    const user = line.includes('"type":"user"') ? messageText(line, 'user') : '';
    const text = user || (line.includes('"type":"assistant"') ? messageText(line, 'assistant') : '');
    if (text) lastPreview = normalizeSessionPreview(text);
  }
  return {
    preview: preview || '(空会话)',
    ...(lastPreview && lastPreview !== preview ? { lastPreview } : {}),
    lineCount,
  };
}

/** Number of trailing message lines scanned for the "most recent" preview. */
const TAIL_MESSAGE_LINES = 200;

function messageText(line: string, type: 'user' | 'assistant'): string {
  try {
    const obj = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
    if (obj.type !== type || !obj.message) return '';
    return extractUserText(obj.message.content);
  } catch {
    return '';
  }
}

function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text.trim();
      }
    }
  }
  return '';
}

/**
 * Delete one session transcript under this cwd.
 *
 * `sessionId` must look like a real id (hex/uuid), so a stray argument can
 * never escape the project directory. Returns false when the file was not
 * there to begin with.
 */
export async function deleteSessionFile(cwd: string, sessionId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(sessionId)) return false;
  try {
    await unlink(join(claudeProjectDir(cwd), `${sessionId}.jsonl`));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Format a relative time like "3 小时前", "昨天", "3 天前". */
export function formatRelTime(mtime: number): string {
  const diffMs = Date.now() - mtime;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  return `${mo} 个月前`;
}
