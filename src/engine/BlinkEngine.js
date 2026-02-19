/**
 * BlinkEngine — Orchestrates code execution via blinkenlib.wasm
 *
 * Two modes
 * ─────────
 *   Real mode  — BlinkRuntime loads blinkenlib.wasm and executes ELF binaries
 *                through the Blink x86-64 emulator.  Active when the WASM file
 *                is present and the runtime instantiates without error.
 *
 *   Demo mode  — Falls back to a simple regex-based output simulator so the
 *                UI remains functional while the compiler toolchain (Phase 2/3)
 *                is not yet integrated.
 *
 * Execution flow (real mode)
 * ──────────────────────────
 *   execute(elfBytes)  →  BlinkRuntime.run(elfBytes)
 *                         ├─ malloc + copy ELF into WASM heap
 *                         ├─ blinkenlib_start(ptr, len)
 *                         └─ blinkenlib_run_fast()  →  stdout/stderr callbacks
 */

import { BlinkRuntime } from './BlinkRuntime.js';

export class BlinkEngine {
  constructor() {
    this._runtime  = new BlinkRuntime();
    this.demoMode  = true;   // flipped to false when WASM loads successfully
    this.ready     = false;
    this._onStdout = null;
    this._onStderr = null;
  }

  onStdout(cb) { this._onStdout = cb; this._runtime.onStdout = cb; }
  onStderr(cb) { this._onStderr = cb; this._runtime.onStderr = cb; }

  /**
   * Load blinkenlib.wasm.  Falls back to demo mode on any failure.
   * @returns {boolean} true if real WASM execution is available
   */
  async load() {
    try {
      await this._runtime.load('/assets/blinkenlib.wasm');
      this.demoMode = false;
      this.ready    = true;
      console.info('[BlinkEngine] blinkenlib.wasm loaded — real execution enabled');
      return true;
    } catch (err) {
      this.demoMode = true;
      this.ready    = true;
      console.info('[BlinkEngine] Demo mode —', err.message);
      return false;
    }
  }

  /**
   * Execute code or an ELF binary.
   *
   * @param {Uint8Array|null} elfBytes  - Pre-compiled ELF (null = use sourceCode)
   * @param {{ sourceCode?: string, lang?: string }} opts
   */
  async execute(elfBytes, opts = {}) {
    if (!this.ready) throw new Error('Engine not initialised — call load() first');

    // Real mode: elfBytes provided and WASM is live
    if (!this.demoMode && elfBytes instanceof Uint8Array) {
      return this._runtime.run(elfBytes);
    }

    // Demo mode (or no elfBytes yet — compiler not wired)
    return this._demoExecute(opts);
  }

  /* ── Demo mode ───────────────────────────────────────────────────────── */

  async _demoExecute({ sourceCode = '', lang = 'c' }) {
    await sleep(lang === 'c' ? 600 : 80);
    const t0 = Date.now();

    const runners = { c: this._runC, asm: this._runAsm };
    const stdout  = (runners[lang] ?? this._runGeneric).call(this, sourceCode);

    stdout.split('\n').forEach(line => {
      if (line !== '' || stdout.endsWith('\n')) this._onStdout?.(line + '\n');
    });

    return {
      exitCode:   0,
      runtime:    Date.now() - t0 + (lang === 'c' ? 800 : 20),
      instrCount: Math.floor(Math.random() * 50000) + 5000,
      registers:  this._fakeRegisters(),
    };
  }

  _runC(code) {
    const lines = [];
    const re = /printf\s*\(\s*"((?:[^"\\]|\\.)*?)"/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      lines.push(
        m[1].replace(/\\n/g, '\n')
             .replace(/\\t/g, '\t')
             .replace(/\x1b\[[0-9;]*m/g, '')
             .replace(/%[0-9.*]*[disxXfFeEgGcp]/g, '?')
      );
    }
    return lines.length
      ? lines.join('')
      : '[HelixCore Demo] C program executed.\nfib(10) = 55\n';
  }

  _runAsm(code) {
    const m = /db\s+"([^"]+)"/g.exec(code);
    return (m ? m[1] : 'Hello from HelixCore x86-64!') + '\n';
  }

  _runGeneric() { return '[HelixCore] Program exited with code 0\n'; }

  _fakeRegisters() {
    const h = () => '0x' + Math.floor(Math.random() * 0xFFFFFFFF)
                             .toString(16).padStart(16, '0');
    return { rax: h(), rbx: h(), rcx: h(), rdx: h(), rsp: h(), rbp: h(), rip: h() };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
