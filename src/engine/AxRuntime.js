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

import { initAx, Axecutor, Mnemonic, Register, axVersion } from './AxBridge.js';

export class AxRuntime {
  constructor() {
    this._initialized = false;
    /** @type {import('./VirtualFS.js').VirtualFS | null} */
    this.vfs = null;
    /** @type {((text: string) => void) | null} */
    this.onStdout = null;
    /** @type {((text: string) => void) | null} */
    this.onStderr = null;

    // File descriptor table: { fd: { path, offset } }
    this._fds = new Map();
    this._nextFd = 3;

    // Heap management (brk)
    this._heapStart = 0x800000n; // Initial heap start
    this._brk       = 0x800000n; // Current program break
    this._heapMapped = false;

    this._registerBaselineEnabled = Boolean(import.meta.env?.DEV);
    this._stdoutBuffer = '';
    this._stderrBuffer = '';
    this._traceEnabled = Boolean(import.meta.env?.DEV);
    this._traceMaxSteps = 64;
    this._traceMaxSyscalls = 64;
  }

  setRegisterBaseline(enabled) {
    this._registerBaselineEnabled = Boolean(enabled);
  }

  setTraceLogging(enabled) {
    this._traceEnabled = Boolean(enabled);
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
   * @param {Array} sourceMap
   * @returns {{ exitCode: number, runtime: number, instrCount: number, registers: object }}
   */
  async run(elfBytes, sourceMap = []) {
    if (!this._initialized) throw new Error('AxRuntime not loaded — call load() first');

    const ax = Axecutor.from_binary(elfBytes);

    // Set up the System V ABI stack (argc/argv/envp)
    // Most binaries expect at least some environment variables
    ax.init_stack_program_start(
      128n * 1024n,      // Increased stack to 128 KB for safety
      ['/bin/program'],  // argv[0]
      ['TERM=xterm-256color', 'PATH=/usr/bin:/bin', 'HOME=/root'],
    );

    if (this._registerBaselineEnabled) {
      this._applyRegisterBaseline(ax);
    }

    let exitCode = 0;
    let stopReason = 'unknown';
    const rt = this;
    const trace = {
      enabled: this._traceEnabled,
      steps: [],
      syscalls: [],
      stopReason: 'unknown',
    };

    // Reset FD table and heap for each run
    this._fds.clear();
    this._nextFd = 3;
    this._brk = this._heapStart;
    this._heapMapped = false;
    this._stdoutBuffer = '';
    this._stderrBuffer = '';

    // Intercept every `syscall` instruction before it executes
    ax.hook_before_mnemonic(Mnemonic.Syscall, (instance) => {
      try {
      const num = instance.reg_read_64(Register.RAX);
      if (rt._traceEnabled && trace.syscalls.length < rt._traceMaxSyscalls) {
        trace.syscalls.push({
          idx: trace.syscalls.length,
          rip: this._toHex(instance.reg_read_64(Register.RIP)),
          num: Number(num),
          rdi: this._toHex(instance.reg_read_64(Register.RDI)),
          rsi: this._toHex(instance.reg_read_64(Register.RSI)),
          rdx: this._toHex(instance.reg_read_64(Register.RDX)),
        });
      }

      // ── read(fd, buf, len) ─────────────────────────────────────────────
      if (num === 0n) {
        const fd  = Number(instance.reg_read_64(Register.RDI));
        const ptr = instance.reg_read_64(Register.RSI);
        const len = Number(instance.reg_read_64(Register.RDX));

        const file = rt._fds.get(fd);
        if (!file || !rt.vfs) {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -9n)); // EBADF
          return instance.commit();
        }

        const data = rt.vfs.readSync(file.path);
        if (!data) {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -5n)); // EIO
          return instance.commit();
        }

        const remaining = data.length - file.offset;
        const toRead = Math.min(len, remaining);

        if (toRead > 0) {
          const chunk = data.slice(file.offset, file.offset + toRead);
          instance.mem_write_bytes(ptr, chunk);
          file.offset += toRead;
        }

        instance.reg_write_64(Register.RAX, BigInt(toRead));
        return instance.commit();
      }

      // ── write(fd, buf, len) ────────────────────────────────────────────
      if (num === 1n) {
        const fd  = instance.reg_read_64(Register.RDI);
        const ptr = instance.reg_read_64(Register.RSI);
        const len = instance.reg_read_64(Register.RDX);
        const buf = instance.mem_read_bytes(ptr, len);

        if (fd === 1n || fd === 2n) {
          const text = new TextDecoder().decode(buf);
          rt._appendOutput(fd, text);
          instance.reg_write_64(Register.RAX, len);
        } else {
          // Write to virtual file
          const file = rt._fds.get(Number(fd));
          if (!file || !rt.vfs) {
            instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -9n)); // EBADF
          } else {
            let writeOffset = file.offset;
            if (file.append) {
              const size = rt.vfs.getSizeSync(file.path);
              writeOffset = size < 0 ? 0 : size;
            }
            const written = rt.vfs.writeAtSync(file.path, buf, writeOffset);
            file.offset = writeOffset + written;
            instance.reg_write_64(Register.RAX, BigInt(written));
          }
        }
        return instance.commit();
      }

      // ── open(pathname, flags, mode) ────────────────────────────────────
      if (num === 2n) {
        const pathPtr = instance.reg_read_64(Register.RDI);
        const flags = Number(instance.reg_read_64(Register.RSI));
        // Read null-terminated string
        let path = '';
        let curr = pathPtr;
        while (true) {
          const b = instance.mem_read_bytes(curr++, 1n)[0];
          if (b === 0) break;
          path += String.fromCharCode(b);
        }

        if (!rt.vfs) {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -5n)); // EIO
          return instance.commit();
        }

        const O_CREAT  = 0x40;
        const O_TRUNC  = 0x200;
        const O_APPEND = 0x400;

        const data = rt.vfs.readSync(path);
        if (data === null) {
          if (flags & O_CREAT) {
            rt.vfs.writeSync(path, new Uint8Array(0));
          } else {
            instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -2n)); // ENOENT
            return instance.commit();
          }
        }

        if ((flags & O_TRUNC) && !(flags & O_APPEND)) {
          rt.vfs.truncateSync(path, 0);
        }

        const fd = rt._nextFd++;
        const initialOffset = (flags & O_APPEND)
          ? Math.max(0, rt.vfs.getSizeSync(path))
          : 0;
        rt._fds.set(fd, {
          path,
          offset: initialOffset,
          append: Boolean(flags & O_APPEND),
        });
        instance.reg_write_64(Register.RAX, BigInt(fd));
        return instance.commit();
      }

      // ── close(fd) ──────────────────────────────────────────────────────
      if (num === 3n) {
        const fd = Number(instance.reg_read_64(Register.RDI));
        if (rt._fds.has(fd)) {
          rt._fds.delete(fd);
          instance.reg_write_64(Register.RAX, 0n);
        } else {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -9n)); // EBADF
        }
        return instance.commit();
      }

      // ── stat(pathname, statbuf) ────────────────────────────────────────
      if (num === 4n) {
        const pathPtr = instance.reg_read_64(Register.RDI);
        const statPtr = instance.reg_read_64(Register.RSI);
        
        let path = '';
        let curr = pathPtr;
        while (true) {
          const b = instance.mem_read_bytes(curr++, 1n)[0];
          if (b === 0) break;
          path += String.fromCharCode(b);
        }

        if (!rt.vfs) {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -5n)); // EIO
          return instance.commit();
        }

        const size = rt.vfs.getSizeSync(path);
        if (size === -1) {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -2n)); // ENOENT
          return instance.commit();
        }

        // Fill a minimal struct stat (x86-64)
        // Offset 48: st_size (8 bytes)
        // Offset 24: st_nlink (8 bytes)
        // Offset 0: st_dev (8 bytes)
        // Offset 8: st_ino (8 bytes)
        // Offset 16: st_mode (4 bytes)
        instance.mem_write_64(statPtr + 48n, BigInt(size));
        instance.mem_write_32(statPtr + 16n, 0x81edn); // -rw-r--r-- regular file
        instance.reg_write_64(Register.RAX, 0n);
        return instance.commit();
      }

      // ── fstat(fd, statbuf) ─────────────────────────────────────────────
      if (num === 5n) {
        const fd      = Number(instance.reg_read_64(Register.RDI));
        const statPtr = instance.reg_read_64(Register.RSI);

        const file = rt._fds.get(fd);
        if (!file || !rt.vfs) {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -9n)); // EBADF
          return instance.commit();
        }

        const size = rt.vfs.getSizeSync(file.path);
        instance.mem_write_64(statPtr + 48n, BigInt(size));
        instance.mem_write_32(statPtr + 16n, 0x81edn); 
        instance.reg_write_64(Register.RAX, 0n);
        return instance.commit();
      }

      // ── brk(addr) ──────────────────────────────────────────────────────
      if (num === 12n) {
        const addr = instance.reg_read_64(Register.RDI);
        
        if (addr === 0n) {
          // If 0, return current break
          instance.reg_write_64(Register.RAX, rt._brk);
          return instance.commit();
        }

        // Simplistic heap expansion: we just allow it up to a limit (16 MB)
        const limit = rt._heapStart + (16n * 1024n * 1024n);
        if (addr >= rt._heapStart && addr < limit) {
          if (!rt._heapMapped) {
            // Lazy-init the first page if needed
            instance.mem_init_zero_named(rt._heapStart, 4096n, 'heap');
            rt._heapMapped = true;
          }
          
          // If we need to resize the section (ax-x86 supports resizing sections)
          if (addr > rt._brk) {
            const currentSize = rt._brk - rt._heapStart;
            const newSize     = addr - rt._heapStart;
            // Pad to 4KB page
            const paddedSize = (newSize + 4095n) & ~4095n;
            if (paddedSize > currentSize) {
              instance.mem_resize_section(rt._heapStart, paddedSize);
            }
          }

          rt._brk = addr;
          instance.reg_write_64(Register.RAX, rt._brk);
        } else {
          // Error or return current break
          instance.reg_write_64(Register.RAX, rt._brk);
        }
        return instance.commit();
      }

      // ── mmap(addr, len, prot, flags, fd, offset) ───────────────────────
      if (num === 9n) {
        const addr  = instance.reg_read_64(Register.RDI);
        const len   = instance.reg_read_64(Register.RSI);
        const prot  = Number(instance.reg_read_64(Register.RDX));
        const flags = Number(instance.reg_read_64(Register.R10));
        const fd    = Number(instance.reg_read_64(Register.R8));

        // Simplistic: only support anonymous mapping for now (MAP_ANONYMOUS = 0x20)
        const MAP_ANON = 0x20;
        if (flags & MAP_ANON) {
          const v = instance.mem_init_zero_anywhere(len);
          instance.mem_prot(v, prot);
          instance.reg_write_64(Register.RAX, v);
        } else {
          instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -22n)); // EINVAL
        }
        return instance.commit();
      }

      // ── exit(code) / exit_group(code) ─────────────────────────────────
      if (num === 60n || num === 231n) {
        exitCode = Number(instance.reg_read_64(Register.RDI));
        stopReason = `exit(${exitCode})`;
        return instance.stop();   // halt emulation cleanly
      }

      // ── unknown syscall → ENOSYS ──────────────────────────────────────
      instance.reg_write_64(Register.RAX, BigInt.asUintN(64, -38n));
      return instance.commit();
      } catch (err) {
        stopReason = 'hook-error';
        if (this._traceEnabled && trace.syscalls.length < this._traceMaxSyscalls) {
          trace.syscalls.push({
            idx: trace.syscalls.length,
            rip: this._toHex(instance.reg_read_64(Register.RIP)),
            num: -1,
            error: err?.message ?? String(err),
          });
        }
        rt.onStderr?.(`[AxRuntime Hook Error] ${err?.message ?? String(err)}`);
        exitCode = 1;
        return instance.stop();
      }
    });

    let instrCount = 0;
    const t0 = performance.now();
    
    // Read register helper (best-effort; ax may have stopped mid-run)
    const r64 = (reg) => {
      try {
        const v = ax.reg_read_64(reg);
        return '0x' + v.toString(16).padStart(16, '0');
      } catch {
        return '0x0000000000000000';
      }
    };

    // Execute instructions one-by-one until stop.
    // Using step() here avoids async-hook issues seen with execute() in some builds.
    try {
      while (true) {
        if (this._traceEnabled && trace.steps.length < this._traceMaxSteps) {
          trace.steps.push({
            idx: trace.steps.length,
            rip: this._toHex(ax.reg_read_64(Register.RIP)),
            rsp: this._toHex(ax.reg_read_64(Register.RSP)),
            rax: this._toHex(ax.reg_read_64(Register.RAX)),
          });
        }
        const keepRunning = await ax.step();
        instrCount++;
        if (!keepRunning) {
          if (stopReason === 'unknown') stopReason = 'step-returned-stop';
          break;
        }
      }
    } catch (err) {
      stopReason = 'error';
      // Log the register state when an error occurs to help debug
      const ripVal = r64(Register.RIP);
      let debugMsg = `AX EXECUTION ERROR at RIP=${ripVal}: ${err.message}`;

      // Use source map to find where in the original code the error occurred
      if (sourceMap && sourceMap.length) {
        // Find the closest VA that is <= ripVal
        const ripNum = BigInt(ripVal);
        let bestMatch = null;
        for (const entry of sourceMap) {
          const entryVA = BigInt(entry.va);
          if (entryVA <= ripNum) {
            if (!bestMatch || entryVA > BigInt(bestMatch.va)) {
              bestMatch = entry;
            }
          }
        }

        if (bestMatch) {
          debugMsg += ` (at source line ${bestMatch.line}, col ${bestMatch.col})`;
        }
      }

      console.error(debugMsg, err);
      const enhancedErr = new Error(debugMsg);
      enhancedErr.cause = err;
      throw enhancedErr;
    }

    trace.stopReason = stopReason;

    this._flushOutputBuffers(true);

    const registers = {
      rax: r64(Register.RAX),
      rbx: r64(Register.RBX),
      rcx: r64(Register.RCX),
      rdx: r64(Register.RDX),
      rsi: r64(Register.RSI),
      rdi: r64(Register.RDI),
      rsp: r64(Register.RSP),
      rbp: r64(Register.RBP),
      rip: r64(Register.RIP),
    };

    return {
      exitCode,
      runtime:    Math.round(performance.now() - t0),
      instrCount,
      registers,
      trace,
      disassembly: this._buildDisassembly(elfBytes, sourceMap),
      memory: await this._buildMemorySnapshot(ax, registers),
    };
  }

  _toHex(value) {
    try {
      return '0x' + BigInt(value).toString(16).padStart(16, '0');
    } catch {
      return '0x0000000000000000';
    }
  }

  _buildDisassembly(elfBytes, sourceMap = []) {
    try {
      if (!elfBytes || elfBytes.length < 120) return [];

      const view = new DataView(elfBytes.buffer, elfBytes.byteOffset, elfBytes.byteLength);
      const entry = view.getBigUint64(24, true);
      const phoff = Number(view.getBigUint64(32, true));
      const pVaddr = view.getBigUint64(phoff + 16, true);
      const pOffset = Number(view.getBigUint64(phoff + 8, true));
      const pFileSz = Number(view.getBigUint64(phoff + 32, true));

      const textOffset = 120;
      const textSize = Math.max(0, Math.min(256, pFileSz - textOffset));
      const textBytes = elfBytes.slice(textOffset, textOffset + textSize);
      const lines = [];

      const sourceByVa = new Map();
      for (const s of sourceMap ?? []) sourceByVa.set(s.va, s);

      const baseVa = pVaddr + BigInt(textOffset - pOffset);

      for (let i = 0; i < textBytes.length; i += 8) {
        const chunk = textBytes.slice(i, i + 8);
        const va = baseVa + BigInt(i);
        const vaHex = `0x${va.toString(16).padStart(16, '0')}`;
        const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
        const marker = va === entry ? '▶' : ' ';
        const src = sourceByVa.get(vaHex);

        lines.push({
          va: vaHex,
          marker,
          bytes: hex,
          text: 'db ' + [...chunk].map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '),
          source: src ? `C:${src.line}:${src.col}` : '',
        });
      }

      return lines;
    } catch {
      return [];
    }
  }

  async _buildMemorySnapshot(ax, registers) {
    const parseHex = (value) => {
      try { return BigInt(value); } catch { return 0n; }
    };

    const dump = (base, bytes) => {
      const rows = [];
      for (let i = 0; i < bytes.length; i += 16) {
        const chunk = bytes.slice(i, i + 16);
        const addr = base + BigInt(i);
        rows.push({
          addr: `0x${addr.toString(16).padStart(16, '0')}`,
          hex: [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' '),
          ascii: [...chunk].map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join(''),
        });
      }
      return rows;
    };

    const safeRead = (addr, len) => {
      try {
        return ax.mem_read_bytes(addr, BigInt(len));
      } catch {
        return new Uint8Array(0);
      }
    };

    const rip = parseHex(registers.rip);
    const rsp = parseHex(registers.rsp);
    const brk = this._brk;

    return {
      rip: dump(rip, safeRead(rip, 64)),
      stack: dump(rsp, safeRead(rsp, 128)),
      heap: dump(brk > 64n ? brk - 64n : this._heapStart, safeRead(brk > 64n ? brk - 64n : this._heapStart, 64)),
    };
  }

  _applyRegisterBaseline(ax) {
    const regs = [
      Register.RAX,
      Register.RBX,
      Register.RCX,
      Register.RDX,
      Register.RSI,
      Register.RDI,
      Register.RBP,
    ];

    for (const reg of regs) {
      try {
        ax.reg_write_64(reg, 0n);
      } catch {
      }
    }
  }

  _appendOutput(fd, text) {
    if (fd === 1n) {
      this._stdoutBuffer += text;
      this._drainOutputBuffer('_stdoutBuffer', this.onStdout);
      return;
    }

    if (fd === 2n) {
      this._stderrBuffer += text;
      this._drainOutputBuffer('_stderrBuffer', this.onStderr);
    }
  }

  _drainOutputBuffer(key, sink) {
    let idx = this[key].indexOf('\n');
    while (idx !== -1) {
      const line = this[key].slice(0, idx);
      sink?.(line);
      this[key] = this[key].slice(idx + 1);
      idx = this[key].indexOf('\n');
    }
  }

  _flushOutputBuffers(force = false) {
    if (!force) return;
    if (this._stdoutBuffer.length) {
      this.onStdout?.(this._stdoutBuffer);
      this._stdoutBuffer = '';
    }
    if (this._stderrBuffer.length) {
      this.onStderr?.(this._stderrBuffer);
      this._stderrBuffer = '';
    }
  }
}
