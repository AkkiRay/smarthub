// env-loader: runtime-чтение `.env` в production (в dev это делает Vite).
// Поддерживает KEY=VALUE, кавычки, escape \n\t\\. Без ${VAR} и multiline.

import { existsSync, readFileSync } from 'node:fs';
import type { App } from 'electron';

const KV_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function parse(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, ''); // BOM на первой строке
    if (!line || line.trim().startsWith('#')) continue;
    const m = KV_RE.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;

    // Inline-комментарий снимаем только вне кавычек — внутри # допустим.
    if (!/^['"]/.test(value)) {
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');

    out[key] = value;
  }
  return out;
}

interface LoadResult {
  loadedFrom: string[];
  applied: number;
}

/**
 * Приоритет: `<userData>/.env` → `<resourcesPath>/.env` → `<appPath>/.env`.
 * Shell-export не перетираем (имеет наивысший приоритет).
 */
export function loadRuntimeEnv(app: App): LoadResult {
  const candidates = [
    `${app.getPath('userData')}/.env`,
    `${process.resourcesPath ?? ''}/.env`,
    `${app.getAppPath()}/.env`,
  ].filter((p) => p && p !== '/.env');

  const loaded: string[] = [];
  let applied = 0;

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = parse(readFileSync(path, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        // Shell-export и более приоритетный файл не перетираем.
        if (process.env[k] === undefined) {
          process.env[k] = v;
          applied++;
        }
      }
      loaded.push(path);
    } catch {
      // Повреждённый файл не должен валить запуск.
    }
  }

  return { loadedFrom: loaded, applied };
}
