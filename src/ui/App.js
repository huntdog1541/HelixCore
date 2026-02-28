/**
 * App — Root application controller
 * Instantiates and connects: BlinkEngine, VirtualFS, Editor, Terminal, UI components
 */

import { AxRuntime }   from '../engine/AxRuntime.js';
import { Compiler }    from '../engine/Compiler.js';
import { VirtualFS }   from '../engine/VirtualFS.js';
import { Editor }      from '../editor/Editor.js';
import { DEMO_FILES }  from '../editor/demoFiles.js';
import { Terminal }    from '../terminal/Terminal.js';
import { Titlebar }    from './Titlebar.js';
import { Sidebar }     from './Sidebar.js';
import { StatusBar }   from './StatusBar.js';

export class App {
  constructor(rootEl) {
    this.root     = rootEl;
    this.engine   = new AxRuntime();
    this.compiler = new Compiler();
    this.vfs      = new VirtualFS();
    this._running = false;
  }

  async boot() {
    this._buildDOM();
    this._mountComponents();
    this._wireEvents();
    this._wireResizers();
    await this._bootSequence();
  }

  _buildDOM() {
    this.root.innerHTML = `
      <header id="titlebar"></header>
      <aside  id="sidebar"></aside>
      <div    id="rsz-sidebar"  class="resize-handle-v"></div>
      <main   id="editor-area"></main>
      <div    id="rsz-terminal" class="resize-handle-v"></div>
      <aside  id="terminal-area"></aside>
      <footer id="statusbar"></footer>
    `;
  }

  _mountComponents() {
    this.titlebar  = new Titlebar(document.getElementById('titlebar')).mount();
    this.sidebar   = new Sidebar(document.getElementById('sidebar')).mount();
    this.editor    = new Editor(document.getElementById('editor-area')).mount();
    this.terminal  = new Terminal(document.getElementById('terminal-area')).mount();
    this.statusbar = new StatusBar(document.getElementById('statusbar')).mount();
  }

  _wireEvents() {
    this.sidebar.on('fileselect', ({ name }) => this.editor.loadFile(name));
    this.sidebar.on('run',   () => this.runProgram());
    this.sidebar.on('clear', () => this.terminal.clear());
    this.sidebar.on('elfupload', ({ file }) => this._handleElfUpload(file));
    this.sidebar.on('filecreate', ({ name }) => this._createFile(name));
    this.sidebar.on('filerename', ({ oldName, newName }) => this._renameFile(oldName, newName));
    this.sidebar.on('filedelete', ({ name }) => this._deleteFile(name));

    this.editor.on('cursor', ({ line, col }) => this.statusbar.setCursor(line, col));
    this.editor.on('dirty',  ({ name, dirty }) => {
      this.sidebar.setDirty(name, dirty);
      if (!dirty) return;
      const code = this.editor.getFileContent(name);
      this.vfs.write(this._vfsPath(name), code).catch(() => {});
    });

    this.engine.onStdout = chunk => this.terminal.write(chunk, 'stdout');
    this.engine.onStderr = chunk => this.terminal.error(chunk);
  }

  _wireResizers() {
    const root = this.root;

    // Initialise CSS variables so getPropertyValue works before first drag
    root.style.setProperty('--sidebar-w',  '220px');
    root.style.setProperty('--terminal-w', '300px');

    const makeDragger = (handle, cssVar, dxSign, min, max) => {
      handle.addEventListener('mousedown', e => {
        const startX = e.clientX;
        const startW = parseFloat(root.style.getPropertyValue(cssVar));

        // Transparent overlay keeps the col-resize cursor while dragging
        // over CodeMirror or any other element that would steal it
        const shield = document.createElement('div');
        shield.style.cssText = 'position:fixed;inset:0;cursor:col-resize;z-index:9999';
        document.body.appendChild(shield);

        const onMove = ev => {
          const w = Math.max(min, Math.min(max, startW + (ev.clientX - startX) * dxSign));
          root.style.setProperty(cssVar, `${w}px`);
        };
        const onUp = () => {
          shield.remove();
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
        e.preventDefault();
      });
    };

    // Sidebar handle: drag right → sidebar grows  (dxSign = +1)
    makeDragger(document.getElementById('rsz-sidebar'),  '--sidebar-w',  +1, 140, 520);
    // Terminal handle: drag right → terminal shrinks (dxSign = −1)
    makeDragger(document.getElementById('rsz-terminal'), '--terminal-w', -1, 150, 720);
  }

  async _bootSequence() {
    this.titlebar.setEngineStatus('loading');
    this.terminal.system('HelixCore OS v0.1.0 — ax x86-64 Engine');
    this.terminal.system('─────────────────────────────────────────');

    let loaded = false;
    try {
      await this.engine.load();
      loaded = true;
    } catch (e) {
      console.error(e);
    }

    if (loaded) {
      this.engine.vfs = this.vfs; // Connect VFS to engine
      this.terminal.success('[HelixCore] ax-x86 loaded — real execution enabled');
      this.titlebar.setEngineStatus('ready');
      this.statusbar.setMode('AX');
    } else {
      this.terminal.error('[HelixCore] ax-x86 failed to initialise');
      this.titlebar.setEngineStatus('error');
      this.statusbar.setMode('ERR');
    }

    this.terminal.system('Press ▶ RUN or Ctrl+Enter to execute.');
    this.sidebar.enableRun();
    await this.vfs.open();
    await this._initialiseWorkspaceFiles();
  }

  async runProgram() {
    if (this._running) return;
    this._running = true;
    this.sidebar.disableRun();
    this.titlebar.setEngineStatus('running');

    const lang = this.sidebar.getLang();
    const code = this.editor.getCode();
    const file = this.editor.getFile();

    this.terminal.clear();
    this.terminal.system(`[HelixCore] Executing: ${file}`);

    const cmdMap = {
      c:   `chibicc ${file} -> defasm -> ax ./program`,
      asm: `defasm ${file} -> ax ./program`,
      sh:  `sh ./${file}`,
      elf: `ax ./${file}`,
    };
    this.terminal.cmd(cmdMap[lang] ?? `ax ./${file}`);

    try {
      let elfBytes = null;
      let sourceMap = [];
      if (lang === 'asm') {
        this.terminal.system('[HelixCore] Assembling...');
        const result = this.compiler.assembleGas(code);
        elfBytes = result.elf;
        const kb = (elfBytes.length / 1024).toFixed(1);
        this.terminal.success(`[HelixCore] Assembled — ${kb} KB ELF`);
      } else if (lang === 'c') {
        this.terminal.system('[HelixCore] Compiling C...');
        const result = await this.compiler.compileC(code);
        elfBytes = result.elf;
        sourceMap = result.sourceMap;
        const kb = (elfBytes.length / 1024).toFixed(1);
        this.terminal.success(`[HelixCore] Compiled — ${kb} KB ELF`);
      } else if (lang === 'sh') {
        throw new Error('Shell execution is not implemented yet. Use ASM, C, or ELF.');
      } else if (lang === 'elf') {
        elfBytes = await this.vfs.read(`/home/user/${file}`);
      } else {
        throw new Error(`Unsupported language mode: ${lang}`);
      }

      if (!elfBytes && (lang === 'asm' || lang === 'elf')) {
        throw new Error(`No binary found for ${file}`);
      }

      let result;
      if (elfBytes) {
        result = await this.engine.run(elfBytes, sourceMap);
      } else {
        throw new Error(`No executable payload produced for ${file}`);
      }

      this.terminal.success('─────────────────────────────────────────');
      this.terminal.system(`[HelixCore] Exit: ${result.exitCode} | ${result.runtime}ms | ${result.instrCount.toLocaleString()} instructions`);
      this.terminal.updateProcessInfo(result);
      if (result.registers) this.terminal.updateRegisters(result.registers);
      this.statusbar.setLastExit(result.exitCode);
    } catch (err) {
      this.terminal.error(`[Error] ${err.message}`);
      this.statusbar.setLastExit(1);
    }

    this._running = false;
    this.sidebar.enableRun();
    this.titlebar.setEngineStatus('ready');
  }

  async _handleElfUpload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!Compiler.isValidElf(bytes)) {
      this.terminal.error(`[Error] ${file.name} is not a valid ELF binary`);
      return;
    }
    const info = Compiler.parseElfHeader(bytes);
    this.terminal.success(`[HelixCore] ELF loaded: ${file.name} | ${info.arch} | ${info.type} | entry: ${info.entryPoint}`);
    this.terminal.info('Press ▶ RUN to execute.');
    await this.vfs.write(`/home/user/${file.name}`, bytes);
    this.editor.addFile(file.name, '');
    this.sidebar.setFiles(this.editor.listFiles(), file.name);
    this.sidebar.selectFile(file.name, true);
  }

  _vfsPath(name) {
    return `/home/user/${name}`;
  }

  async _initialiseWorkspaceFiles() {
    const existing = await this.vfs.list('/home/user');
    const existingFiles = existing.filter(e => !e.isDir).map(e => e.name);

    if (!existingFiles.length) {
      for (const [name, content] of Object.entries(DEMO_FILES)) {
        await this.vfs.write(this._vfsPath(name), content);
      }
    }

    const files = await this.vfs.list('/home/user');
    const fileMap = {};

    for (const entry of files) {
      if (entry.isDir) continue;
      const bytes = await this.vfs.read(this._vfsPath(entry.name));
      if (!bytes) continue;

      if (entry.name.endsWith('.elf') || entry.name.endsWith('.bin') || entry.name.endsWith('.com')) {
        fileMap[entry.name] = '';
      } else {
        fileMap[entry.name] = new TextDecoder().decode(bytes);
      }
    }

    if (!Object.keys(fileMap).length) {
      fileMap['main.c'] = '';
    }

    const active = Object.keys(fileMap)[0];
    this.editor.setFiles(fileMap, active);
    this.sidebar.setFiles(this.editor.listFiles(), active);
    this.sidebar.selectFile(active, true);
  }

  _isValidFilename(name) {
    if (!name) return false;
    if (name.includes('/') || name.includes('\\')) return false;
    return true;
  }

  async _createFile(name) {
    const fileName = (name ?? '').trim();
    if (!this._isValidFilename(fileName)) {
      this.terminal.error('[Error] Invalid file name');
      return;
    }
    if (this.editor.hasFile(fileName)) {
      this.terminal.error(`[Error] File already exists: ${fileName}`);
      return;
    }

    this.editor.addFile(fileName, '');
    await this.vfs.write(this._vfsPath(fileName), '');
    this.sidebar.setFiles(this.editor.listFiles(), fileName);
    this.sidebar.selectFile(fileName, true);
  }

  async _renameFile(oldName, newName) {
    const from = (oldName ?? '').trim();
    const to = (newName ?? '').trim();
    if (!this._isValidFilename(to)) {
      this.terminal.error('[Error] Invalid file name');
      return;
    }
    if (!this.editor.hasFile(from)) {
      this.terminal.error(`[Error] File not found: ${from}`);
      return;
    }
    if (from === to) return;
    if (this.editor.hasFile(to)) {
      this.terminal.error(`[Error] File already exists: ${to}`);
      return;
    }

    const content = this.editor.getFileContent(from);
    this.editor.renameFile(from, to);
    await this.vfs.write(this._vfsPath(to), content);
    await this.vfs.delete(this._vfsPath(from));

    this.sidebar.setFiles(this.editor.listFiles(), to);
    this.sidebar.selectFile(to, true);
  }

  async _deleteFile(name) {
    const target = (name ?? '').trim();
    if (!this.editor.hasFile(target)) return;

    const names = this.editor.listFiles();
    if (names.length <= 1) {
      this.terminal.error('[Error] Cannot delete the last file');
      return;
    }

    const wasActive = this.editor.getFile() === target;
    this.editor.deleteFile(target);
    await this.vfs.delete(this._vfsPath(target));

    const next = this.editor.listFiles()[0];
    this.sidebar.setFiles(this.editor.listFiles(), wasActive ? next : this.sidebar.getActiveFile());
    if (wasActive) this.sidebar.selectFile(next, true);
    else this.sidebar.selectFile(this.sidebar.getActiveFile(), false);
  }
}