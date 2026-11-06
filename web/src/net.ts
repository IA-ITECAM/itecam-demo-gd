/** Cliente WebSocket con reconexión automática. */
export type Handler = (msg: any) => void;

export class TwinSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private closed = false;
  private retry = 0;
  onStatus: (ok: boolean) => void = () => {};

  constructor(private gemelo: string) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?gemelo=${encodeURIComponent(this.gemelo)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.onStatus(false);
      if (this.closed) return;
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 300 * this.retry);
    };
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(cmd: string, args: Record<string, unknown> = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ cmd, args }));
  }

  close() {
    this.closed = true;
    this.handlers.clear();
    this.ws?.close();
  }
}
