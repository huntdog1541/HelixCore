/**
 * Sidebar — File tree + run controls + language selector
 */

import { EventEmitter } from '../utils/EventEmitter.js';

export class Sidebar extends EventEmitter {
  constructor(el) {
    super();
    this.el = el;
    this._active = null;
    this._files = [];
  }

    mount() {
        this.el.innerHTML = `
      <div class="sidebar-section">Files</div>
      <div class="sidebar-actions" style="padding-top:0;padding-bottom:8px">
        <button class="btn btn-secondary" id="file-new-btn" style="flex:1">NEW</button>
        <button class="btn btn-secondary" id="file-ren-btn" style="flex:1">REN</button>
        <button class="btn btn-secondary" id="file-del-btn" style="flex:1">DEL</button>
      </div>
      <div class="file-tree" id="file-tree"></div>

      <div class="sidebar-section">Language</div>
      <select class="lang-select" id="lang-select">
        <option value="c">C (Chibicc)</option>
        <option value="asm">x86-64 Assembly (GAS/AT&T)</option>
        <option value="sh">Shell Script (sh)</option>
        <option value="elf">ELF Binary (upload)</option>
      </select>

      <label class="sidebar-toggle" for="register-baseline-toggle">
        <input type="checkbox" id="register-baseline-toggle" />
        <span>Deterministic Regs</span>
      </label>

      <div class="sidebar-actions">
        <button class="btn btn-run" id="run-btn" disabled>▶ RUN</button>
      </div>
      <div class="sidebar-actions" style="padding-top:0">
        <button class="btn btn-secondary" id="clear-btn" style="flex:1">CLR</button>
        <button class="btn btn-secondary" id="upload-btn" style="flex:1">ELF ↑</button>
      </div>
      <input type="file" id="elf-upload" accept=".elf,.bin,.com" style="display:none" />
    `;

        this._renderTree();
        document.getElementById('file-new-btn').onclick = () => this._promptCreate();
        document.getElementById('file-ren-btn').onclick = () => this._promptRename();
        document.getElementById('file-del-btn').onclick = () => this._promptDelete();
        document.getElementById('run-btn').onclick    = () => this.emit('run');
        document.getElementById('clear-btn').onclick  = () => this.emit('clear');
        document.getElementById('register-baseline-toggle').onchange = e => {
          this.emit('registerbaseline', { enabled: Boolean(e.target.checked) });
        };
        document.getElementById('upload-btn').onclick = () => document.getElementById('elf-upload').click();
        document.getElementById('elf-upload').onchange = e => {
            const file = e.target.files[0];
            if (file) this.emit('elfupload', { file });
        };

        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault(); this.emit('run');
            }
        });
        return this;
    }

    _renderTree() {
        const tree = document.getElementById('file-tree');
        if (!tree) return;

        tree.innerHTML = this._files.map(name => `
      <div class="file-item ${name === this._active ? 'active' : ''}" data-file="${name}">
        <span class="file-icon">${this._iconFor(name)}</span> ${name}
        <span class="dirty-dot" id="dirty-${this._dotId(name)}" style="display:none">●</span>
      </div>
    `).join('');

        tree.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                tree.querySelectorAll('.file-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this._active = item.dataset.file;
                this._autoSetLang(item.dataset.file);
                this.emit('fileselect', { name: item.dataset.file });
            });
        });
    }

    getLang()    { return document.getElementById('lang-select')?.value ?? 'c'; }
    setLang(lang) { const s = document.getElementById('lang-select'); if (s) s.value = lang; }
    enableRun()  { const b = document.getElementById('run-btn'); if (b) b.disabled = false; }
    disableRun() { const b = document.getElementById('run-btn'); if (b) b.disabled = true; }
    getActiveFile() { return this._active; }
    setRegisterBaseline(enabled) {
      const t = document.getElementById('register-baseline-toggle');
      if (t) t.checked = Boolean(enabled);
    }

    setFiles(names, active = null) {
      this._files = [...new Set((names ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      if (this._files.length === 0) {
        this._active = null;
      } else if (active && this._files.includes(active)) {
        this._active = active;
      } else if (!this._active || !this._files.includes(this._active)) {
        this._active = this._files[0];
      }
      this._renderTree();
    }

    selectFile(name, emit = false) {
      if (!this._files.includes(name)) return;
      this._active = name;
      this._renderTree();
      this._autoSetLang(name);
      if (emit) this.emit('fileselect', { name });
    }

    _autoSetLang(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const map  = { c: 'c', cpp: 'c', h: 'c', asm: 'asm', s: 'asm', sh: 'sh', elf: 'elf', bin: 'elf' };
        const lang = map[ext];
        if (lang) this.setLang(lang);
    }

    _iconFor(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      if (ext === 'c' || ext === 'cpp' || ext === 'h') return '◈';
      return '◇';
    }

    _dotId(name) {
      return name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    _promptCreate() {
      const name = window.prompt('New file name', 'newfile.c');
      if (!name) return;
      this.emit('filecreate', { name: name.trim() });
    }

    _promptRename() {
      if (!this._active) return;
      const name = window.prompt('Rename file', this._active);
      if (!name) return;
      this.emit('filerename', { oldName: this._active, newName: name.trim() });
    }

    _promptDelete() {
      if (!this._active) return;
      const ok = window.confirm(`Delete ${this._active}?`);
      if (!ok) return;
      this.emit('filedelete', { name: this._active });
    }

    setDirty(name, dirty) {
      const dot = document.getElementById(`dirty-${this._dotId(name)}`);
        if (dot) dot.style.display = dirty ? 'inline' : 'none';
    }
}