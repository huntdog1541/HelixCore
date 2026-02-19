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
    await sleep(lang === 'c' ? 600 : lang === 'sh' ? 200 : 80);
    const t0 = Date.now();

    const runners = { c: this._runC, asm: this._runAsm, sh: this._runSh };
    const stdout  = (runners[lang] ?? this._runGeneric).call(this, sourceCode);

    stdout.split('\n').forEach(line => {
      if (line !== '' || stdout.endsWith('\n')) this._onStdout?.(line + '\n');
    });

    return {
      exitCode:   0,
      runtime:    Date.now() - t0 + (lang === 'c' ? 800 : lang === 'sh' ? 100 : 20),
      instrCount: Math.floor(Math.random() * 50000) + 5000,
      registers:  this._fakeRegisters(),
    };
  }

  _runC(code) {
    // Detect fibonacci pattern — compute real values instead of placeholders
    if (/fibonacci/.test(code) && /for\s*\(/.test(code)) {
      const fib = n => n <= 1 ? n : fib(n - 1) + fib(n - 2);
      const match = code.match(/i\s*<=\s*(\d+)/);
      const max   = match ? parseInt(match[1], 10) : 10;
      
      // Instead of returning a static block, we'll try to find printf calls 
      // and process them, but if we see the fib(i) pattern, we inject real numbers.
      const lines = [];
      const re = /printf\s*\(\s*"((?:[^"\\]|\\.)*?)"(?:\s*,\s*([^)]*))?\s*\)/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        let fmt = m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        let args = m[2] ? m[2].split(',').map(s => s.trim()) : [];
        
        if (fmt.includes('%d') && args.some(a => a.includes('fibonacci'))) {
          // This is the loop line: printf("  fib(%2d) = %d\n", i, fibonacci(i));
          for (let i = 0; i <= max; i++) {
            lines.push(fmt.replace(/%2d/g, String(i).padStart(2)).replace(/%d/g, fib(i)));
          }
        } else {
          lines.push(fmt.replace(/%[0-9.*]*[disxXfFeEgGcp]/g, '?'));
        }
      }
      return lines.join('');
    }
    // Generic: extract printf string literals
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
    const lines = [];
    // AT&T syntax: .ascii "..." or .string "..."
    const re = /\.(?:ascii|string)\s+"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      lines.push(m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
    }
    // Intel syntax fallback: db "..."
    if (lines.length === 0) {
      const re2 = /db\s+"([^"]+)"/g;
      while ((m = re2.exec(code)) !== null) {
        lines.push(m[1]);
      }
    }
    return lines.length ? lines.join('') : 'Hello from HelixCore x86-64!\n';
  }

  _runSh(code) {
    const out = [];
    for (const raw of code.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      // Match echo with or without quotes
      const m = line.match(/^echo\s+(?:"(.*?)"|'(.*?)'|(.*))\s*$/);
      if (m) {
        const content = m[1] || m[2] || m[3] || '';
        out.push(
          content.replace(/\$\(uname -a\)/g,
            'Linux helixcore 4.5.0-blink-1.0 #1 SMP x86_64 GNU/Linux')
        );
      }
    }
    return out.length ? out.join('\n') + '\n' : '[HelixCore] Shell script exited.\n';
  }

  _runGeneric() { return '[HelixCore] Program exited with code 0\n'; }

  _fakeRegisters() {
    const h = () => '0x' + Math.floor(Math.random() * 0xFFFFFFFF)
                             .toString(16).padStart(16, '0');
    return { rax: h(), rbx: h(), rcx: h(), rdx: h(), rsp: h(), rbp: h(), rip: h() };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
