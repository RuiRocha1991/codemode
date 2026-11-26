/** Semáforo simples: no máximo `max` tarefas em curso; as restantes esperam por ordem de chegada. */
export class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError("max tem de ser um inteiro ≥ 1");
  }

  get running(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      // Passa o lugar diretamente ao próximo, sem libertar o contador.
      if (next) next();
      else this.active--;
    }
  }
}
