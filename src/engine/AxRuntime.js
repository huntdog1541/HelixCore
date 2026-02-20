/**
 * AxRuntime — ax-x86 host environment
 *
 * ax-x86 is an in-browser x86-64 emulator (Rust → WASM via wasm-bindgen).
 * It parses an ELF binary, sets up memory and stack, then runs instructions
 * one at a time. Syscalls are intercepted via a before-Syscall hook so we
 * can implement write (stdout / stderr) and exit ourselves.
 *
 * Supported syscalls
 * ──────────────────
 *   1   write(fd, buf, len)   — fd 1 → onStdout, fd 2 → onStderr
 *   60  exit(code)            — stop execution, record exit code
 *   231 exit_group(code)      — same as exit for our purposes
 *   *   all others            — return ENOSYS and continue
 *
 * Execution model
 * ───────────────
 *   1. await initAx()                       — one-time WASM module init
 *   2. Axecutor.from_binary(elfBytes)       — parse ELF, map PT_LOAD
 *   3. ax.init_stack_program_start(...)     — System V ABI stack setup
 *   4. ax.hook_before_mnemonic(Syscall, fn) — intercept all syscall insns
 *   5. await ax.execute()                   — run until instance.stop()
 */

import initAx, { Axecutor, Mnemonic, Register, version as axVersion } from 'ax-x86';

export class AxRuntime {
  constructor() {
    this._initialized = false;
    /** @type {((text: string) => void) | null} */
    this.onStdout = null;
    /** @type {((text: string) => void) | null} */
    this.onStderr = null;
  }

  /**
   * Initialise the ax-x86 WASM module.
   * Must be awaited before calling run().
   * @returns {string} ax-x86 version string
   */
  async load() {
    await initAx();
    this._initialized = true;
    return axVersion();
  }

  /**
   * Execute an ELF binary.
   * @param {Uint8Array} elfBytes
   * @returns {{ exitCode: number, runtime: number, instrCount: number, registers: object }}
   */
  async run(elfBytes) {
    if (!this._initialized) throw new Error('AxRuntime not loaded — call load() first');

    const ax = Axecutor.from_binary(elfBytes);

    // Set up the System V ABI stack (argc/argv/envp)
    ax.init_stack_program_start(
      8n * 1024n,        // 8 KB stack
      ['/bin/program'],  // argv[0]
      ['TERM=xterm-256color'],
    );

    let exitCode = 0;
    const rt = this;

    // Intercept every `syscall` instruction before it executes
    ax.hook_before_mnemonic(Mnemonic.Syscall, (instance) => {
      const num = instance.reg_read_64(Register.RAX);

      // ── write(fd, buf, len) ────────────────────────────────────────────
      if (num === 1n) {
        const fd  = instance.reg_read_64(Register.RDI);
        const ptr = instance.reg_read_64(Register.RSI);
        const len = instance.reg_read_64(Register.RDX);
        const buf = instance.mem_read_bytes(ptr, len);
        const text = new TextDecoder().decode(buf);

        if      (fd === 1n) rt.onStdout?.(text);
        else if (fd === 2n) rt.onStderr?.(text);

        instance.reg_write_64(Register.RAX, len);   // return bytes written
        return instance.commit();
      }

      // ── exit(code) / exit_group(code) ─────────────────────────────────
      if (num === 60n || num === 231n) {
        exitCode = Number(instance.reg_read_64(Register.RDI));
        return instance.stop();   // halt emulation cleanly
      }

      // ── unknown syscall → ENOSYS ──────────────────────────────────────
      instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -38n));
      return instance.commit();
    });

    const t0 = performance.now();
    await ax.execute();

    // Read final register state (best-effort; ax may have stopped mid-run)
    const r64 = (reg) => {
      try {
        const v = ax.reg_read_64(reg);
        return '0x' + v.toString(16).padStart(16, '0');
      } catch {
        return '0x0000000000000000';
      }
    };

    return {
      exitCode,
      runtime:    Math.round(performance.now() - t0),
      instrCount: 0,   // ax doesn't expose an instruction counter
      registers: {
        rax: r64(Register.RAX),
        rbx: r64(Register.RBX),
        rcx: r64(Register.RCX),
        rdx: r64(Register.RDX),
        rsp: r64(Register.RSP),
        rbp: r64(Register.RBP),
        rip: r64(Register.RIP),
      },
    };
  }
}
