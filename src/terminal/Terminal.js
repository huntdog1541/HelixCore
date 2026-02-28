/**
 * Terminal — Output display component
 * Renders stdout/stderr/system messages from the Blink engine.
 */

export class Terminal {
  constructor(containerEl) {
    this.container = containerEl;
    this._output   = null;
    this._cursor   = null;
    this._activeView = 'editor';
  }

  mount() {
    this.container.innerHTML = `
      <div class="terminal-header">
        <span>⬡ ENGINE OUTPUT</span>
        <div class="terminal-controls">
          <button class="terminal-btn" id="term-clear" title="Clear">✕</button>
          <button class="terminal-btn" id="term-bottom" title="Scroll to bottom">↓</button>
        </div>
      </div>
      <div id="terminal-output"></div>
      <div id="process-info"></div>
      <div id="registers"></div>
      <div id="disassembly"></div>
      <div id="memory"></div>
    `;
    this._output = this.container.querySelector('#terminal-output');
    this.container.querySelector('#term-clear').onclick  = () => this.clear();
    this.container.querySelector('#term-bottom').onclick = () => this.scrollToBottom();
    this._appendCursor();
    this.setView('editor');
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
    const dis = this.container.querySelector('#disassembly');
    const mem = this.container.querySelector('#memory');
    if (dis) dis.innerHTML = '';
    if (mem) mem.innerHTML = '';
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
    const names = ['rax','rbx','rcx','rdx','rsi','rdi','rsp','rbp','rip'];
    el.innerHTML = names.map(r => `
      <div class="reg-row">
        <span class="reg-name">${r.toUpperCase()}</span>
        <span class="reg-val">${regs[r] ?? '0x0000000000000000'}</span>
      </div>
    `).join('');
  }

  updateDisassembly(rows = []) {
    const el = this.container.querySelector('#disassembly');
    if (!el) return;

    if (!rows.length) {
      el.innerHTML = `<div class="section-title">DISASSEMBLY</div><div class="empty-state">No disassembly available.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="section-title">DISASSEMBLY</div>
      <div class="disasm-table">
        ${rows.map(r => `
          <div class="disasm-row">
            <span class="disasm-mark">${r.marker ?? ' '}</span>
            <span class="disasm-va">${r.va}</span>
            <span class="disasm-bytes">${r.bytes}</span>
            <span class="disasm-text">${r.text}</span>
            <span class="disasm-src">${r.source ?? ''}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  updateMemory(snapshot = {}) {
    const el = this.container.querySelector('#memory');
    if (!el) return;

    const renderBlock = (title, rows = []) => {
      if (!rows.length) {
        return `<div class="mem-block"><div class="mem-title">${title}</div><div class="empty-state">No data</div></div>`;
      }
      return `
        <div class="mem-block">
          <div class="mem-title">${title}</div>
          <div class="mem-table">
            ${rows.map(r => `
              <div class="mem-row">
                <span class="mem-addr">${r.addr}</span>
                <span class="mem-hex">${r.hex}</span>
                <span class="mem-ascii">${r.ascii}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    el.innerHTML = `
      <div class="section-title">MEMORY</div>
      ${renderBlock('RIP WINDOW', snapshot.rip)}
      ${renderBlock('STACK', snapshot.stack)}
      ${renderBlock('HEAP TAIL', snapshot.heap)}
    `;
  }

  setView(tab) {
    this._activeView = tab;
    const showEditor = tab === 'editor';
    const showDisasm = tab === 'disasm';
    const showMemory = tab === 'memory';

    const out = this.container.querySelector('#terminal-output');
    const p = this.container.querySelector('#process-info');
    const r = this.container.querySelector('#registers');
    const d = this.container.querySelector('#disassembly');
    const m = this.container.querySelector('#memory');

    if (out) out.style.display = showEditor ? 'block' : 'none';
    if (p) p.style.display = showEditor ? 'block' : 'none';
    if (r) r.style.display = showEditor ? 'block' : 'none';
    if (d) d.style.display = showDisasm ? 'block' : 'none';
    if (m) m.style.display = showMemory ? 'block' : 'none';
  }

  _appendCursor() {
    this._cursor = document.createElement('p');
    this._cursor.className = 'term-line term-cursor';
    this._output.appendChild(this._cursor);
  }

  _removeCursor() { this._cursor?.remove(); this._cursor = null; }
  _stripAnsi(s)   { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
}