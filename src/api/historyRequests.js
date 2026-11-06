export function createHistoryRequests(interval = 1000) {
  let queue = Promise.resolve();
  let nextStart = 0;
  return (load, assertCurrent = () => {}) => {
    const result = queue.then(async () => {
      assertCurrent();
      const wait = nextStart - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      assertCurrent();
      nextStart = Date.now() + interval;
      return load();
    });
    queue = result.catch(() => {});
    return result;
  };
}
