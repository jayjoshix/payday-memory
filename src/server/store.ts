import { mkdir, open, readFile, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Single-process durable files. A corrupt document is an error, never an empty history. */
export class AtomicJsonStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}

  private file(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid storage key');
    return path.join(this.directory, `${name}.json`);
  }

  async read<T>(name: string): Promise<T | undefined> {
    await this.queue;
    try {
      return JSON.parse(await readFile(this.file(name), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error(`Could not read ${name}; local state was preserved for recovery`, {
        cause: error,
      });
    }
  }

  write(name: string, value: unknown): Promise<void> {
    const operation = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const destination = this.file(name);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  /** Deletes only disposable session files. It never touches canonical state or sponsor evidence. */
  clearSessions(): Promise<void> {
    const operation = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const entries = await readdir(this.directory);
      await Promise.all(
        entries
          .filter((name) => /^session-[0-9a-f-]+\.json$/.test(name))
          .map((name) => unlink(path.join(this.directory, name))),
      );
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
