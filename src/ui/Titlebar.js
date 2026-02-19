/**
 * Titlebar — Top navigation bar + engine status indicator
 */

import { EventEmitter } from '../utils/EventEmitter.js';

export class Titlebar extends EventEmitter {
    constructor(el) { super(); this.el = el; }

    mount() {
        this.el.innerHTML = `
      <div class="logo"><span class="logo-helix">⬡</span> HELIXCORE</div>
      <nav class="nav-tabs">
        <button class="nav-tab active" data-tab="editor">Editor</button>
        <button class="nav-tab" data-tab="disasm">Disassembly</button>
        <button class="nav-tab" data-tab="memory">Memory</button>
      </nav>
      <div class="header-controls">
        <div class="blink-status">
          <div class="status-dot" id="engine-dot"></div>
          <span id="engine-label">LOADING</span>
        </div>
      </div>
    `;

        this.el.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.el.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.emit('tabchange', { tab: tab.dataset.tab });
            });
        });
        return this;
    }

    setEngineStatus(state) {
        const dot = document.getElementById('engine-dot');
        const lbl = document.getElementById('engine-label');
        if (dot) dot.className = `status-dot ${state}`;
        if (lbl) lbl.textContent = { loading:'LOADING', ready:'READY', demo:'DEMO', running:'RUNNING', error:'ERROR' }[state] ?? state.toUpperCase();
    }
}