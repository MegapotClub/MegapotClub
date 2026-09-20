/** Deterministic shared Web Locks model for cross-tab journal/submission tests. */
export function createLocks() {
  const lanes = new Map<string, Promise<unknown>>();
  return {
    request: async (
      name: string,
      options: unknown,
      callback?: (lock: unknown) => unknown,
    ) => {
      const cb = (typeof options === "function" ? options : callback) as (
        lock: unknown,
      ) => unknown;
      if (
        typeof options === "object" &&
        options &&
        "ifAvailable" in options &&
        lanes.has(name)
      )
        return cb(null);
      const previous = lanes.get(name) ?? Promise.resolve();
      const task = previous.catch(() => {}).then(() => cb({ name }));
      lanes.set(name, task);
      try {
        return await task;
      } finally {
        if (lanes.get(name) === task) lanes.delete(name);
      }
    },
  };
}
