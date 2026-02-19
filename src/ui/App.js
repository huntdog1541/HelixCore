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
    await this._bootSequence();
  }

  _buildDOM() {
    this.root.innerHTML = `
      <header id="titlebar"></header>
      <aside  id="sidebar"></aside>
      <main   id="editor-area"></main>
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

  async _bootSequence() {
    this.titlebar.setEngineStatus('loading');
    this.terminal.system('HelixCore OS v0.1.0 — Blink x86-64 Engine');
    this.terminal.system('─────────────────────────────────────────');

    const wasmReady = await this.engine.load();

    if (wasmReady) {
      this.terminal.success('[HelixCore] blinkenlib.wasm loaded — real execution enabled');
      this.titlebar.setEngineStatus('ready');
      this.statusbar.setMode('BLINK');
    } else {
      this.terminal.info('[HelixCore] Demo mode — add blinkenlib.wasm to /public/assets/ to enable real execution');
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
      c:   `cosmocc -O2 ${file} -o program && blink ./program`,
      asm: `nasm -f elf64 ${file} && ld -o program program.o && blink ./program`,
      sh:  `sh ./${file}`,
      elf: `blink ./${file}`,
    };
    this.terminal.cmd(cmdMap[lang] ?? `blink ./${file}`);

    try {
      // In real mode, compile assembly to ELF before executing
      let elfBytes = null;
      if (!this.engine.demoMode && lang === 'asm') {
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