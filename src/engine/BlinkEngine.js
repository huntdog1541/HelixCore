/**
 * BlinkEngine — WebAssembly wrapper for blinkenlib.wasm
 *
 * To enable real execution:
 *   1. Copy blinkenlib.wasm + blinkenlib.js to /public/assets/
 *   2. Uncomment the WASM import block in load()
 *   3. Replace _demoExecute() calls with real VM calls in execute()
 *
 * Source: https://github.com/robalb/x86-64-playground
 */

export class BlinkEngine {
  constructor() {
    this.wasm      = null;
    this.ready     = false;
    this.demoMode  = false;
    this._onStdout = null;
    this._onStderr = null;
  }

  onStdout(cb) { this._onStdout = cb; }
  onStderr(cb) { this._onStderr = cb; }

  async load() {
    try {
      const res = await fetch('/assets/blinkenlib.wasm', { method: 'HEAD' });
      if (res.ok) {
        // ── REAL WASM INTEGRATION ──────────────────────────
        // const { default: initBlink } = await import('/assets/blinkenlib.js');
        // this.wasm = await initBlink('/assets/blinkenlib.wasm');
        // this.ready = true;
        // return true;
        // ──────────────────────────────────────────────────
        console.info('[BlinkEngine] blinkenlib.wasm found (integration pending)');
      }
    } catch (_) {}

    this.demoMode = true;
    this.ready    = true;
    console.info('[BlinkEngine] Demo mode active');
    return false;
  }

  async execute(elfBytes, opts = {}) {
    if (!this.ready) throw new Error('Engine not initialized — call load() first');
    if (this.demoMode) return this._demoExecute(opts);

    // ── REAL WASM EXECUTION ──────────────────────────────
    // const vm = this.wasm.createVM();
    // vm.loadElf(elfBytes);
    // vm.onStdout = (chunk) => this._onStdout?.(chunk);
    // vm.onStderr = (chunk) => this._onStderr?.(chunk);
    // const result = vm.run({ args: opts.args || [], env: opts.env || {} });
    // return {
    //   stdout: result.stdout, stderr: result.stderr,
    //   exitCode: result.exitCode, runtime: result.runtimeMs,
    //   instrCount: result.instructionCount, registers: vm.getRegisters(),
    // };
    // ─────────────────────────────────────────────────────

    throw new Error('WASM execution not yet wired — see BlinkEngine.js');
  }

  async _demoExecute({ sourceCode = '', lang = 'c' }) {
    await sleep(400 + Math.random() * 300);
    const t0 = Date.now();

    const runners = { c: this._runC, asm: this._runAsm };
    const stdout  = (runners[lang] ?? this._runGeneric).call(this, sourceCode);

    stdout.split('\n').forEach(line => this._onStdout?.(line + '\n'));

    return {
      stdout,
      stderr:     '',
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
      lines.push(m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t')
          .replace(/\x1b\[[0-9;]*m/g, '').replace(/%[0-9.*]*[disxXfFeEgGcp]/g, '?'));
    }
    if (!lines.length) {
      return '[HelixCore Demo] C program executed.\nfib(10) = 55\n[HelixCore] Exit 0.\n';
    }
    return lines.join('');
  }

  _runAsm(code) {
    const m = /db\s+"([^"]+)"/g.exec(code);
    return (m ? m[1] : 'Hello from HelixCore x86-64!') + '\n';
  }

  _runGeneric() { return '[HelixCore] Program exited with code 0\n'; }

  _fakeRegisters() {
    const h = () => '0x' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(16, '0');
    return { rax: h(), rbx: h(), rcx: h(), rdx: h(), rsp: h(), rbp: h(), rip: h() };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }