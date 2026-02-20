/**
 * App — Root application controller
 * Instantiates and connects: BlinkEngine, VirtualFS, Editor, Terminal, UI components
 */

import { BlinkEngine } from '../engine/BlinkEngine.js';
import { Compiler }    from '../engine/Compiler.js';
import { VirtualFS }   from '../engine/VirtualFS.js';
import { Editor }      from '../editor/Editor.js';
import { Terminal }    from '../terminal/Terminal.js';
import { Titlebar }    from './Titlebar.js';
import { Sidebar }     from './Sidebar.js';
import { StatusBar }   from './StatusBar.js';

export class App {
  constructor(rootEl) {
    this.root     = rootEl;
    this.engine   = new BlinkEngine();
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

    this.editor.on('cursor', ({ line, col }) => this.statusbar.setCursor(line, col));
    this.editor.on('dirty',  ({ name, dirty }) => this.sidebar.setDirty(name, dirty));

    this.engine.onStdout(chunk => this.terminal.write(chunk, 'stdout'));
    this.engine.onStderr(chunk => this.terminal.error(chunk));
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

    const wasmReady = await this.engine.load();

    if (wasmReady) {
      this.terminal.success('[HelixCore] ax-x86 loaded — real execution enabled');
      this.titlebar.setEngineStatus('ready');
      this.statusbar.setMode('AX');
    } else {
      this.terminal.info('[HelixCore] Demo mode — ax-x86 failed to initialise');
      this.titlebar.setEngineStatus('demo');
      this.statusbar.setMode('DEMO');
    }

    this.terminal.system('Press ▶ RUN or Ctrl+Enter to execute.');
    this.sidebar.enableRun();
    await this.vfs.open();
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
      c:   `cosmocc -O2 ${file} -o program && ax ./program`,
      asm: `nasm -f elf64 ${file} && ld -o program program.o && ax ./program`,
      sh:  `sh ./${file}`,
      elf: `ax ./${file}`,
    };
    this.terminal.cmd(cmdMap[lang] ?? `ax ./${file}`);

    try {
      // Assemble assembly to ELF even in demo mode to catch syntax errors
      let elfBytes = null;
      if (lang === 'asm') {
        this.terminal.system('[HelixCore] Assembling...');
        elfBytes = this.compiler.assembleGas(code);
        const kb = (elfBytes.length / 1024).toFixed(1);
        this.terminal.success(`[HelixCore] Assembled — ${kb} KB ELF`);
      }

      const result = await this.engine.execute(elfBytes, { sourceCode: code, lang });
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
    this.titlebar.setEngineStatus(this.engine.demoMode ? 'demo' : 'ready');
  }

  async _handleElfUpload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!Compiler.isValidElf(bytes)) {
      this.terminal.error(`[Error] ${file.name} is not a valid ELF binary`);
      return;
    }
    const info = Compiler.parseElfHeader(bytes);
    this.terminal.success(`[HelixCore] ELF loaded: ${file.name} | ${info.arch} | ${info.type} | entry: ${info.entryPoint}`);
    this.terminal.info('Press ▶ RUN to execute in Blink.');
    await this.vfs.write(`/home/user/${file.name}`, bytes);
  }
}