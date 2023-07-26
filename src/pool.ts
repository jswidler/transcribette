// Simple generic pool implementation to limit concurrency.
export class Pool {
  private semaphore: Semaphore;

  constructor(poolSize: number) {
    this.semaphore = new Semaphore(poolSize);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const permit = await this.semaphore.acquire();
    try {
      return await fn();
    } finally {
      permit.release();
    }
  }

  numActive() {
    return this.semaphore.current();
  }

  numQueued() {
    return this.semaphore.queueSize();
  }
}

// A model of a Permit to do some task, the holder MUST call release() when done.
interface Permit {
  release: () => void;
}

export class Semaphore {
  private queue: { resolve: (p: Permit) => void }[] = [];
  private currentConcurrency = 0;

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<Permit> {
    return new Promise((resolve) => {
      const permit = {
        release: () => {
          if (this.queue.length > 0) {
            const nextPermit = this.queue.shift();
            nextPermit?.resolve(permit);
          } else {
            this.currentConcurrency--;
          }
        },
      };

      if (this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        resolve(permit);
      } else {
        this.queue.push({ resolve });
      }
    });
  }

  current() {
    return this.currentConcurrency;
  }

  queueSize() {
    return this.queue.length;
  }
}


