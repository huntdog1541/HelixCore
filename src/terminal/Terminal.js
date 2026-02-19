/**
 * Terminal — Output display component
 * Renders stdout/stderr/system messages from the Blink engine.
 */

export class Terminal {
  constructor(containerEl) {
    this.container = containerEl;
    this._output   = null;
    this._cursor   = null;
  }

  mount() {
    this.container.innerHTML = `
      <div class="terminal-header">
        <span>⬡ BLINK OUTPUT</span>
        <div class="terminal-controls">
          <button class="terminal-btn" id="term-clear" title="Clear">✕</button>
          <button class="terminal-btn" id="term-bottom" title="Scroll to bottom">↓</button>
        </div>
      </div>
      <div id="terminal-output"></div>
      <div id="process-info"></div>
      <div id="registers"></div>
    `;
    this._output = this.container.querySelector('#terminal-output');
    this.container.querySelector('#term-clear').onclick  = () => this.clear();
    this.container.querySelector('#term-bottom').onclick = () => this.scrollToBottom();
    this._appendCursor();
    return this;
  }

  write(text, type = 'stdout') {
    this._removeCursor();
    text.split('\n').forEach(line => {
      if (!line) return;
      const p = document.createElement('p');
      p.className = `term-line ${type}`;
      p.textContent = this._stripAnsi(line);
      this._output.appendChild(p);
    });
    this._appendCursor();
    this.scrollToBottom();
  }

  system(text)  { this.write(text, 'system');  }
  error(text)   { this.write(text, 'stderr');  }
  cmd(text)     { this.write('$ ' + text, 'cmd'); }
  success(text) { this.write(text, 'success'); }
  info(text)    { this.write(text, 'info');    }

  clear() {
    this._output.innerHTML = '';
    this._cursor = null;
    this._appendCursor();
  }

  scrollToBottom() { this._output.scrollTop = this._output.scrollHeight; }

  updateProcessInfo({ exitCode, runtime, instrCount }) {
    const el = this.container.querySelector('#process-info');
    if (!el) return;
    el.innerHTML = `
      <div class="proc-row"><span class="proc-label">EXIT CODE</span><span class="proc-value">${exitCode}</span></div>
      <div class="proc-row"><span class="proc-label">RUNTIME</span><span class="proc-value">${runtime}ms</span></div>
      <div class="proc-row"><span class="proc-label">INSTRUCTIONS</span><span class="proc-value">${instrCount.toLocaleString()}</span></div>
    `;
  }

  updateRegisters(regs) {
    const el = this.container.querySelector('#registers');
    if (!el) return;
    const names = ['rax','rbx','rcx','rdx','rsp','rbp','rip'];
    el.innerHTML = names.map(r => `
      <div class="reg-row">
        <span class="reg-name">${r.toUpperCase()}</span>
        <span class="reg-val">${regs[r] ?? '0x0000000000000000'}</span>
      </div>
    `).join('');
  }

  _appendCursor() {
    this._cursor = document.createElement('p');
    this._cursor.className = 'term-line term-cursor';
    this._output.appendChild(this._cursor);
  }

  _removeCursor() { this._cursor?.remove(); this._cursor = null; }
  _stripAnsi(s)   { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
}