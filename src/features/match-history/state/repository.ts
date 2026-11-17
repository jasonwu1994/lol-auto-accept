/**
 * Cross-tab caches for finished-game data (upstream `gameSummaryLruMap`, 128 entries,
 * no TTL) plus single-flight loading. Everything is dropped when the AuthScope changes.
 */
export class Lru<K, V> {
  private entries = new Map<K, V>()
  constructor(private readonly limit: number) {}
  get(key: K): V | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }
  set(key: K, value: V) {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as K)
  }
  has(key: K) {
    return this.entries.has(key)
  }
  clear() {
    this.entries.clear()
  }
  get size() {
    return this.entries.size
  }
}

export class SingleFlight {
  private pending = new Map<string, Promise<unknown>>()
  run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as Promise<T> | undefined
    if (existing) return existing
    const promise = load().finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.pending.set(key, promise)
    return promise
  }
  clear() {
    this.pending.clear()
  }
  get size() {
    return this.pending.size
  }
}

/** Runs at most `concurrency` tasks; queued tasks can be dropped before they start. */
export class TaskQueue {
  private queue: Array<() => void> = []
  private running = 0
  constructor(private readonly concurrency: number) {}
  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running++
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running--
            this.next()
          })
      }
      ;(start as { reject?: (reason: unknown) => void }).reject = reject
      this.queue.push(start)
      this.next()
    })
  }
  private next() {
    while (this.running < this.concurrency && this.queue.length) this.queue.shift()!()
  }
  clear() {
    const dropped = this.queue
    this.queue = []
    dropped.forEach(task => (task as { reject?: (reason: unknown) => void }).reject?.(new Error('Cancelled')))
  }
  get pendingCount() {
    return this.queue.length
  }
}

export interface Repository<Game, Timeline> {
  games: Lru<string, Game>
  timelines: Lru<string, Timeline>
  flights: SingleFlight
  clear(): void
}

export function createRepository<Game, Timeline>(gameLimit = 128, timelineLimit = 32): Repository<Game, Timeline> {
  const repository = {
    games: new Lru<string, Game>(gameLimit),
    timelines: new Lru<string, Timeline>(timelineLimit),
    flights: new SingleFlight(),
    clear() {
      repository.games.clear()
      repository.timelines.clear()
      repository.flights.clear()
    }
  }
  return repository
}
