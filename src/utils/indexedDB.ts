import { CodeFile, TerminalLog } from '../types';

const DB_NAME = 'JacoStudioDB';
const DB_VERSION = 2;

const STORES = {
  CODE_FILES: 'codeFiles',
  TERMINAL_LOGS: 'terminalLogs',
  APP_STATE: 'appState',
  OLLAMA_CACHE: 'ollamaCache',
};

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Code files store
      if (!db.objectStoreNames.contains(STORES.CODE_FILES)) {
        db.createObjectStore(STORES.CODE_FILES, { keyPath: 'path' });
      }

      // Terminal logs store
      if (!db.objectStoreNames.contains(STORES.TERMINAL_LOGS)) {
        db.createObjectStore(STORES.TERMINAL_LOGS, { keyPath: 'id' });
      }

      // Key-value store for app metadata
      if (!db.objectStoreNames.contains(STORES.APP_STATE)) {
        db.createObjectStore(STORES.APP_STATE, { keyPath: 'key' });
      }

      // Ollama response cache store
      if (!db.objectStoreNames.contains(STORES.OLLAMA_CACHE)) {
        const cacheStore = db.createObjectStore(STORES.OLLAMA_CACHE, { keyPath: 'cacheKey' });
        cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
        cacheStore.createIndex('queryText', 'queryText', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };
  });

  return dbPromise;
}

// ==================== CODE FILES PERSISTENCE ====================

export async function loadCodeFilesFromIDB(): Promise<CodeFile[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CODE_FILES, 'readonly');
      const store = tx.objectStore(STORES.CODE_FILES);
      const req = store.getAll();

      req.onsuccess = () => {
        resolve(req.result || []);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Error loading code files from IndexedDB:', err);
    return [];
  }
}

export async function saveCodeFilesToIDB(files: CodeFile[]): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.CODE_FILES, 'readwrite');
    const store = tx.objectStore(STORES.CODE_FILES);

    for (const file of files) {
      store.put(file);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Error saving code files to IndexedDB:', err);
  }
}

export async function saveSingleCodeFileToIDB(file: CodeFile): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.CODE_FILES, 'readwrite');
    const store = tx.objectStore(STORES.CODE_FILES);
    store.put(file);
  } catch (err) {
    console.warn('Error saving file to IndexedDB:', err);
  }
}

// ==================== TERMINAL LOGS PERSISTENCE ====================

export async function loadTerminalLogsFromIDB(): Promise<TerminalLog[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.TERMINAL_LOGS, 'readonly');
      const store = tx.objectStore(STORES.TERMINAL_LOGS);
      const req = store.getAll();

      req.onsuccess = () => {
        // Return logs sorted or as saved
        resolve(req.result || []);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Error loading terminal logs from IndexedDB:', err);
    return [];
  }
}

export async function saveTerminalLogsToIDB(logs: TerminalLog[]): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.TERMINAL_LOGS, 'readwrite');
    const store = tx.objectStore(STORES.TERMINAL_LOGS);

    // Keep last 100 logs to prevent unbounded DB growth
    const recentLogs = logs.slice(0, 100);

    for (const log of recentLogs) {
      store.put(log);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Error saving terminal logs to IndexedDB:', err);
  }
}

export async function saveTerminalLogToIDB(log: TerminalLog): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.TERMINAL_LOGS, 'readwrite');
    const store = tx.objectStore(STORES.TERMINAL_LOGS);
    store.put(log);
  } catch (err) {
    console.warn('Error saving terminal log to IndexedDB:', err);
  }
}

export async function clearTerminalLogsFromIDB(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.TERMINAL_LOGS, 'readwrite');
    const store = tx.objectStore(STORES.TERMINAL_LOGS);
    store.clear();
  } catch (err) {
    console.warn('Error clearing terminal logs from IndexedDB:', err);
  }
}

// ==================== APP METADATA PERSISTENCE ====================

export async function saveAppStateToIDB(key: string, value: any): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.APP_STATE, 'readwrite');
    const store = tx.objectStore(STORES.APP_STATE);
    store.put({ key, value });
  } catch (err) {
    console.warn('Error saving app state to IndexedDB:', err);
  }
}

export async function loadAppStateFromIDB<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.APP_STATE, 'readonly');
      const store = tx.objectStore(STORES.APP_STATE);
      const req = store.get(key);

      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  } catch (err) {
    return defaultValue;
  }
}

// ==================== OLLAMA / AURA MODEL RESPONSE CACHE ====================

export interface OllamaCacheEntry {
  cacheKey: string;
  queryText: string;
  activeFilePath?: string;
  subAgent?: string;
  persona?: string;
  responseData: any;
  timestamp: number;
}

export function generateOllamaCacheKey(queryText: string, activeFilePath?: string, subAgent?: string, persona?: string): string {
  const normQuery = queryText.trim().toLowerCase();
  const normFile = (activeFilePath || '').trim();
  const normAgent = (subAgent || 'all').trim();
  const normPersona = (persona || 'default').trim();
  return `ollama-cache::${normQuery}::${normFile}::${normAgent}::${normPersona}`;
}

export async function getOllamaCache(cacheKey: string): Promise<OllamaCacheEntry | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.OLLAMA_CACHE, 'readonly');
      const store = tx.objectStore(STORES.OLLAMA_CACHE);
      const req = store.get(cacheKey);

      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('Error fetching Ollama cache from IndexedDB:', err);
    return null;
  }
}

export async function saveOllamaCache(entry: OllamaCacheEntry): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.OLLAMA_CACHE, 'readwrite');
    const store = tx.objectStore(STORES.OLLAMA_CACHE);
    store.put(entry);
  } catch (err) {
    console.warn('Error saving Ollama cache to IndexedDB:', err);
  }
}

export async function getAllOllamaCacheEntries(): Promise<OllamaCacheEntry[]> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.OLLAMA_CACHE, 'readonly');
      const store = tx.objectStore(STORES.OLLAMA_CACHE);
      const req = store.getAll();

      req.onsuccess = () => {
        resolve(req.result || []);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('Error loading all Ollama cache entries from IndexedDB:', err);
    return [];
  }
}

export async function clearOllamaCache(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.OLLAMA_CACHE, 'readwrite');
    const store = tx.objectStore(STORES.OLLAMA_CACHE);
    store.clear();
  } catch (err) {
    console.warn('Error clearing Ollama cache from IndexedDB:', err);
  }
}
