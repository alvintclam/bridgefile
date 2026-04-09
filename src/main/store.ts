import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import type { ConnectionProfile, BookmarkEntry } from '../shared/types';

// ── Storage paths ──────────────────────────────────────────────

function getStoragePath(): string {
  const userDataDir = app.getPath('userData');
  return path.join(userDataDir, 'connections.json');
}

function getSecureStoragePath(): string {
  const userDataDir = app.getPath('userData');
  return path.join(userDataDir, 'secure-keys.json');
}

// ── Keytar wrapper (optional secure credential storage) ────────

let keytar: typeof import('keytar') | null = null;
try {
  keytar = require('keytar');
} catch {
  // keytar not available — fall back to JSON file
}

const SERVICE_NAME = 'bridgefile';

async function storeSecret(id: string, key: string, value: string): Promise<void> {
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, `${id}:${key}`, value);
  } else {
    const store = readSecureStore();
    if (!store[id]) store[id] = {};
    store[id][key] = value;
    writeSecureStore(store);
  }
}

async function getSecret(id: string, key: string): Promise<string | null> {
  if (keytar) {
    return keytar.getPassword(SERVICE_NAME, `${id}:${key}`);
  }
  const store = readSecureStore();
  return store[id]?.[key] ?? null;
}

async function deleteSecrets(id: string): Promise<void> {
  if (keytar) {
    // Remove known credential keys
    for (const key of ['password', 'privateKey', 'passphrase', 'secretAccessKey']) {
      try {
        await keytar.deletePassword(SERVICE_NAME, `${id}:${key}`);
      } catch {
        // ignore
      }
    }
  } else {
    const store = readSecureStore();
    delete store[id];
    writeSecureStore(store);
  }
}

function readSecureStore(): Record<string, Record<string, string>> {
  const filePath = getSecureStoragePath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSecureStore(data: Record<string, Record<string, string>>): void {
  const filePath = getSecureStoragePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ── Profile storage (non-secret fields) ────────────────────────

// ── Bookmark storage ──────────────────────────────────────────────

function getBookmarksPath(): string {
  const userDataDir = app.getPath('userData');
  return path.join(userDataDir, 'bookmarks.json');
}

function readBookmarks(): BookmarkEntry[] {
  const filePath = getBookmarksPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeBookmarks(bookmarks: BookmarkEntry[]): void {
  const filePath = getBookmarksPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(bookmarks, null, 2));
}

export function getAllBookmarks(): BookmarkEntry[] {
  return readBookmarks();
}

export function addBookmark(bookmark: Omit<BookmarkEntry, 'id' | 'createdAt'>): BookmarkEntry {
  const bookmarks = readBookmarks();
  const entry: BookmarkEntry = {
    ...bookmark,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  bookmarks.push(entry);
  writeBookmarks(bookmarks);
  return entry;
}

export function deleteBookmark(id: string): boolean {
  const bookmarks = readBookmarks();
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx < 0) return false;
  bookmarks.splice(idx, 1);
  writeBookmarks(bookmarks);
  return true;
}

// ── Profile storage (non-secret fields) ────────────────────────

interface StoredProfile {
  id: string;
  name: string;
  type: 'sftp' | 's3' | 'ftp';
  /** Config WITHOUT sensitive fields (password, privateKey, secretAccessKey) */
  config: Record<string, unknown>;
  lastUsed?: number;
  favorite: boolean;
}

function readProfiles(): StoredProfile[] {
  const filePath = getStoragePath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeProfiles(profiles: StoredProfile[]): void {
  const filePath = getStoragePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(profiles, null, 2));
}

// ── Sensitive field definitions by protocol ────────────────────

const SENSITIVE_KEYS: Record<string, string[]> = {
  sftp: ['password', 'privateKey', 'passphrase', 'proxyPassword'],
  ftp: ['password'],
  s3: ['secretAccessKey'],
};

function extractSecrets(
  type: string,
  config: Record<string, unknown>,
): { clean: Record<string, unknown>; secrets: Record<string, string> } {
  const clean = { ...config };
  const secrets: Record<string, string> = {};
  const keys = SENSITIVE_KEYS[type] ?? [];

  for (const key of keys) {
    if (typeof clean[key] === 'string' && clean[key]) {
      secrets[key] = clean[key] as string;
      delete clean[key];
    }
  }

  return { clean, secrets };
}

// ── CRUD operations ────────────────────────────────────────────

export async function getAllProfiles(): Promise<ConnectionProfile[]> {
  const stored = readProfiles();
  const results: ConnectionProfile[] = [];

  for (const s of stored) {
    const fullConfig = { ...s.config };
    const keys = SENSITIVE_KEYS[s.type] ?? [];

    for (const key of keys) {
      const value = await getSecret(s.id, key);
      if (value) fullConfig[key] = value;
    }

    results.push({
      id: s.id,
      name: s.name,
      type: s.type as 'sftp' | 's3' | 'ftp',
      config: fullConfig as any,
      lastUsed: s.lastUsed,
      favorite: s.favorite,
    });
  }

  return results;
}

export async function getProfileById(id: string): Promise<ConnectionProfile | null> {
  const all = await getAllProfiles();
  return all.find((p) => p.id === id) ?? null;
}

export async function saveProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
  const profiles = readProfiles();

  // Assign ID if new
  if (!profile.id) {
    profile.id = crypto.randomUUID();
  }

  const { clean, secrets } = extractSecrets(
    profile.type,
    profile.config as unknown as Record<string, unknown>,
  );

  // Store secrets separately
  for (const [key, value] of Object.entries(secrets)) {
    await storeSecret(profile.id, key, value);
  }

  const stored: StoredProfile = {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    config: clean,
    lastUsed: profile.lastUsed ?? Date.now(),
    favorite: profile.favorite ?? false,
  };

  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = stored;
  } else {
    profiles.push(stored);
  }

  writeProfiles(profiles);
  return profile;
}

export async function deleteProfile(id: string): Promise<boolean> {
  const profiles = readProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return false;

  profiles.splice(idx, 1);
  writeProfiles(profiles);
  await deleteSecrets(id);

  return true;
}
