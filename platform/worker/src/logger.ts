// A build's logs must be VERBATIM and readable — a failed build has to explain
// itself to a non-expert. This buffer accumulates every line (with stage
// banners) for storage in Build.logs, while also echoing live to the worker's
// stdout so `worker build` streams progress in the terminal.

export class BuildLog {
  private lines: string[] = [];
  private echo: boolean;

  constructor(opts: { echo?: boolean } = {}) {
    this.echo = opts.echo ?? true;
  }

  /** A readable section banner so logs are scannable. */
  banner(title: string): void {
    this.write(`\n${"=".repeat(72)}\n=== ${title}\n${"=".repeat(72)}`);
  }

  /** Append raw text exactly as produced (no reformatting). */
  write(chunk: string): void {
    const text = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;
    this.lines.push(text);
    if (this.echo) process.stdout.write(text + "\n");
  }

  /** A worker-side note (not from a subprocess) — clearly marked. */
  note(msg: string): void {
    this.write(`[worker] ${msg}`);
  }

  toString(): string {
    return this.lines.join("\n");
  }
}
