/**
 * Sidebar — File tree + run controls + language selector
 */

import { EventEmitter } from '../utils/EventEmitter.js';

const FILES = [
    { name: 'main.c',    icon: '◈' },
    { name: 'hello.asm', icon: '◇' },
    { name: 'shell.sh',  icon: '◇' },
];

export class Sidebar extends EventEmitter {
    constructor(el) { super(); this.el = el; this._active = 'main.c'; }

    mount() {
        this.el.innerHTML = `
      <div class="sidebar-section">Files</div>
      <div class="file-tree" id="file-tree"></div>

      <div class="sidebar-section">Language</div>
      <select class="lang-select" id="lang-select">
        <option value="c">C (Cosmopolitan)</option>
        <option value="asm">x86-64 Assembly (NASM)</option>
        <option value="elf">ELF Binary (upload)</option>
      </select>

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
        document.getElementById('run-btn').onclick    = () => this.emit('run');
        document.getElementById('clear-btn').onclick  = () => this.emit('clear');
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
        tree.innerHTML = FILES.map(f => `
      <div class="file-item ${f.name === this._active ? 'active' : ''}" data-file="${f.name}">
        <span class="file-icon">${f.icon}</span> ${f.name}
        <span class="dirty-dot" id="dirty-${f.name}" style="display:none">●</span>
      </div>
    `).join('');

        tree.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                tree.querySelectorAll('.file-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this._active = item.dataset.file;
                this.emit('fileselect', { name: item.dataset.file });
            });
        });
    }

    getLang()    { return document.getElementById('lang-select')?.value ?? 'c'; }
    enableRun()  { const b = document.getElementById('run-btn'); if (b) b.disabled = false; }
    disableRun() { const b = document.getElementById('run-btn'); if (b) b.disabled = true; }

    setDirty(name, dirty) {
        const dot = document.getElementById(`dirty-${name}`);
        if (dot) dot.style.display = dirty ? 'inline' : 'none';
    }
}