// Storage — the ONE place the original app touched a browser API.
//
// The v3.1 app called localStorage directly inside loadJSON/saveJSON. That is
// the single thing that cannot cross to React Native (no localStorage) or to a
// server (no browser). So it is inverted here: the core defines the *shape* of
// a store, and each platform supplies the adapter.
//
//   Web today:      createStore(localStorageAdapter(), "ptAppParent_")
//   React Native:   createStore(asyncStorageAdapter(AsyncStorage), "ptAppParent_")
//   Supabase later: createStore(supabaseAdapter(client, userId), "")
//
// Every method is async, exactly as the original loadJSON/saveJSON already
// were — so calling code does not change when the adapter does.

/** In-memory adapter. Used by tests and as a fallback when storage is blocked. */
export function memoryAdapter() {
  const map = new Map();
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

/**
 * Browser localStorage adapter — behaviourally identical to v3.1, including
 * swallowing quota/access errors rather than throwing.
 */
export function localStorageAdapter(storage) {
  const ls = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!ls) return memoryAdapter();
  return {
    async getItem(key) {
      try {
        return ls.getItem(key);
      } catch (e) {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        ls.setItem(key, value);
      } catch (e) {
        /* best-effort, e.g. quota exceeded — state still holds in memory */
      }
    },
    async removeItem(key) {
      try {
        ls.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    },
    async keys() {
      try {
        return Object.keys(ls);
      } catch (e) {
        return [];
      }
    },
  };
}

/**
 * Wraps an adapter with the JSON + key-prefix behaviour the app expects.
 * The prefix exists because localStorage is scoped per-origin, not per-path:
 * two apps under the same username.github.io domain DO share one bucket.
 */
export function createStore(adapter, prefix = "ptAppParent_") {
  const k = (key) => prefix + key;
  return {
    async loadJSON(key, fallback) {
      try {
        const raw = await adapter.getItem(k(key));
        if (raw != null) return JSON.parse(raw);
      } catch (e) {
        /* missing key or corrupt value — fall through to the fallback */
      }
      return fallback;
    },

    async saveJSON(key, value) {
      try {
        await adapter.setItem(k(key), JSON.stringify(value));
      } catch (e) {
        /* best-effort, matching v3.1 */
      }
    },

    async remove(key) {
      await adapter.removeItem(k(key));
    },

    /**
     * One-time migration carried over from v3.1: earlier builds stored each day
     * under its own `day:YYYY-MM-DD` key.
     */
    async migrateLegacyDay(todayKey, weekType, deload) {
      try {
        const raw = await adapter.getItem(k(`day:${todayKey}`));
        if (raw != null) {
          return { done: JSON.parse(raw), weekType, deload };
        }
      } catch (e) {
        /* nothing to migrate */
      }
      return null;
    },

    /** Full export — the same payload the Backup & restore panel produces. */
    async exportAll() {
      const [settings, log, overrides] = await Promise.all([
        this.loadJSON("settings", {}),
        this.loadJSON("log", {}),
        this.loadJSON("overrides", {}),
      ]);
      return { settings, log, overrides, exportedAt: new Date().toISOString().slice(0, 10) };
    },

    /** Full import — accepts the payload exportAll produces. */
    async importAll(payload) {
      if (!payload || typeof payload !== "object") throw new Error("bad backup shape");
      await Promise.all([
        this.saveJSON("settings", payload.settings || {}),
        this.saveJSON("log", payload.log || {}),
        this.saveJSON("overrides", payload.overrides || {}),
      ]);
    },
  };
}
