import type { PidomBridge } from '../../shared/ipc';

declare global {
  interface Window {
    /** The preload bridge — the renderer's only path to the main process. */
    pidom: PidomBridge;
  }
}

export {};
