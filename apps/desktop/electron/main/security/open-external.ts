/**
 * Allow-list для `shell.openExternal` — http/https/mailto. Остальные schemes
 * (`file:`, `ms-msdt:`, `vscode:`, `javascript:`, `data:`, …) блокируются.
 */

import { shell } from 'electron';
import log from 'electron-log/main.js';

const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const MAX_URL_LENGTH = 2048;

export function safeOpenExternal(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!SAFE_EXTERNAL_SCHEMES.has(parsed.protocol)) {
    log.warn(`shell.openExternal blocked: scheme=${parsed.protocol}`);
    return false;
  }
  // Strip query/hash из mailto: — Outlook исторически парсил `?attach=` как
  // путь к файлу, что превращает mailto: в local-file include для пользователя,
  // кликнувшего «Написать в поддержку».
  if (parsed.protocol === 'mailto:') {
    parsed.search = '';
    parsed.hash = '';
  }
  void shell.openExternal(parsed.toString());
  return true;
}
