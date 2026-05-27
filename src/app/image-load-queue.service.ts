import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ImageLoadQueueService {
  private readonly maxConcurrentLoads = 5;
  private readonly queue: Array<() => void> = [];
  private activeLoads = 0;

  enqueue(task: () => Promise<void>, priority = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const run = (): void => {
        this.activeLoads++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.activeLoads--;
            this.runNext();
          });
      };

      if (priority) {
        this.queue.unshift(run);
      } else {
        this.queue.push(run);
      }

      this.runNext();
    });
  }

  private runNext(): void {
    while (this.activeLoads < this.maxConcurrentLoads && this.queue.length) {
      this.queue.shift()?.();
    }
  }
}
