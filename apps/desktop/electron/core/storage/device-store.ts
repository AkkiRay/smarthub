// SQLite-персистентность (devices/rooms/scenes). WAL + foreign_keys, одно соединение на весь app lifetime.

import { app } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import log from 'electron-log/main.js';
import type { Device, Room, Scene } from '@smarthome/shared';
import { safeJsonParse } from '@smarthome/shared';

export type DeviceStore = Awaited<ReturnType<typeof createDeviceStore>>;

export async function createDeviceStore() {
  const dataDir = join(app.getPath('userData'), 'data');
  await mkdir(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'hub.sqlite');
  const db: DatabaseType = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Идемпотентный DDL: безопасно гонять на каждом старте.
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      driver TEXT NOT NULL,
      external_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_devices_driver ON devices(driver);
    CREATE INDEX IF NOT EXISTS idx_devices_external ON devices(driver, external_id);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  log.info(`DeviceStore ready at ${dbPath}`);

  // Prepared statements переиспользуем — better-sqlite3 рекомендует не компилировать SQL заново.
  const stmts = {
    insertDevice: db.prepare(
      'INSERT OR REPLACE INTO devices (id, payload, driver, external_id, updated_at) VALUES (?, ?, ?, ?, ?)',
    ),
    selectAllDevices: db.prepare('SELECT payload FROM devices ORDER BY updated_at DESC'),
    selectDevice: db.prepare('SELECT payload FROM devices WHERE id = ?'),
    deleteDevice: db.prepare('DELETE FROM devices WHERE id = ?'),

    insertRoom: db.prepare(
      'INSERT OR REPLACE INTO rooms (id, payload, sort_order) VALUES (?, ?, ?)',
    ),
    selectAllRooms: db.prepare('SELECT payload FROM rooms ORDER BY sort_order ASC'),
    deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),

    insertScene: db.prepare(
      'INSERT OR REPLACE INTO scenes (id, payload, updated_at) VALUES (?, ?, ?)',
    ),
    selectAllScenes: db.prepare('SELECT payload FROM scenes ORDER BY updated_at DESC'),
    deleteScene: db.prepare('DELETE FROM scenes WHERE id = ?'),
  };

  // Persisted-row shape: SQLite ничего не знает про domain-типы, payload — JSON-blob.
  interface PayloadRow {
    payload: string;
  }
  const parsePayload = <T>(row: PayloadRow | undefined): T | null =>
    row ? safeJsonParse<T>(row.payload) : null;
  const parseAll = <T>(rows: unknown[]): T[] => {
    const out: T[] = [];
    for (const r of rows) {
      const parsed = safeJsonParse<T>((r as PayloadRow).payload);
      if (parsed !== null) out.push(parsed);
    }
    return out;
  };

  return {
    devices: {
      upsert(device: Device): void {
        stmts.insertDevice.run(
          device.id,
          JSON.stringify(device),
          device.driver,
          device.externalId,
          device.updatedAt,
        );
      },
      list(): Device[] {
        return parseAll<Device>(stmts.selectAllDevices.all());
      },
      get(id: string): Device | null {
        return parsePayload<Device>(stmts.selectDevice.get(id) as PayloadRow | undefined);
      },
      remove(id: string): void {
        stmts.deleteDevice.run(id);
      },
    },
    rooms: {
      upsert(room: Room): void {
        stmts.insertRoom.run(room.id, JSON.stringify(room), room.order);
      },
      list(): Room[] {
        return parseAll<Room>(stmts.selectAllRooms.all());
      },
      remove(id: string): void {
        stmts.deleteRoom.run(id);
      },
    },
    scenes: {
      upsert(scene: Scene): void {
        stmts.insertScene.run(scene.id, JSON.stringify(scene), scene.updatedAt);
      },
      list(): Scene[] {
        return parseAll<Scene>(stmts.selectAllScenes.all());
      },
      remove(id: string): void {
        stmts.deleteScene.run(id);
      },
    },
    close(): void {
      db.close();
    },
  };
}
