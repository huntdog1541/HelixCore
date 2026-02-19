/** StatusBar — Bottom info bar (cursor, mode, exit code) */

import { EventEmitter } from '../utils/EventEmitter.js';

export class StatusBar extends EventEmitter {
    constructor(el) { super(); this.el = el; }

    mount() {
        this.el.innerHTML = `
      <div class="status-item"><span class="status-accent">⬡</span> HELIXCORE OS</div>
      <div class="status-item" id="sb-mode">DEMO</div>
      <div class="status-item" id="sb-cursor">Ln 1, Col 1</div>
      <div class="status-bar-right">
        <div class="status-item" id="sb-exit"></div>
        <div class="status-item">BLINK 1.1.0</div>
        <div class="status-item">x86-64-linux</div>
      </div>
    `;
        return this;
    }

    setCursor(line, col) {
        const el = document.getElementById('sb-cursor');
        if (el) el.textContent = `Ln ${line}, Col ${col}`;
    }

    setMode(mode) {
        const el = document.getElementById('sb-mode');
        if (el) el.textContent = mode;
    }

    setLastExit(code) {
        const el = document.getElementById('sb-exit');
        if (el) el.textContent = `Exit: ${code}`;
    }
}