import type { Game } from '../core/game';
import type { Command } from '../core/types';

/**
 * Where commands go. In singleplayer they are applied straight to the local
 * simulation. A multiplayer layer would implement this by sending commands to
 * an authoritative server (which runs the same `Game`) and applying the
 * snapshots/events it sends back.
 */
export interface CommandSink {
  send(cmd: Command): void;
}

export class LocalTransport implements CommandSink {
  constructor(private readonly game: Game) {}

  send(cmd: Command): void {
    this.game.dispatch(cmd);
  }
}
