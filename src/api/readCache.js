export function createReadCache(limit = 128) {
  const entries = new Map();
  return {
    clear() { entries.clear(); },
    peek(key) {
      const entry = entries.get(key);
      return entry?.expires > Date.now() ? entry.value : undefined;
    },
    read(key, ttl, load) {
      const existing = entries.get(key);
      if (existing && existing.expires > Date.now()) return existing.promise;
      const entry = {expires: Infinity, promise: null};
      entry.promise = Promise.resolve().then(load).then(value => {
        entry.value = value;
        entry.expires = Date.now() + ttl;
        return value;
      }).catch(error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return entry.promise;
    }
  };
}
