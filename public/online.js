// Online multiplayer client: SSE connection, room management, move sync.

export class OnlineGame {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.roomId = null;
    this.color = null;
    this.timeControl = null;
    this.es = null;
  }

  async createRoom(timeControl, vsEngine) {
    const resp = await fetch('/api/createroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeControl, opponent: vsEngine ? 'engine' : undefined }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    this.roomId = data.roomId;
    this.color = data.color;
    this.timeControl = data.timeControl;
    this.connect();
    return data;
  }

  async joinRoom(roomId) {
    const resp = await fetch('/api/joinroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    this.roomId = data.roomId;
    this.color = data.color;
    this.timeControl = data.timeControl;
    this.connect();
    // Start game immediately — creator starts via SSE 'start' event
    if (this.callbacks.onStart) this.callbacks.onStart(data);
    return data;
  }

  connect() {
    this.es = new EventSource(`/api/stream/${this.roomId}`);
    this.es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        this.handleEvent(event);
      } catch {}
    };
    this.es.onerror = () => {
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    };
  }

  handleEvent(event) {
    const cb = this.callbacks['on' + event.type.charAt(0).toUpperCase() + event.type.slice(1)];
    if (cb) cb(event);
  }

  // `fen` is the position the move created: an engine game needs it to ask
  // Stockfish for its reply.
  async sendMove(uci, fen) {
    await fetch('/api/onlinemove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: this.roomId, uci, fen }),
    });
  }

  async leave() {
    if (this.es) { this.es.close(); this.es = null; }
    if (this.roomId) {
      await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId }),
      }).catch(() => {});
    }
    this.roomId = null;
    this.color = null;
  }
}
