/**
 * BlinkRuntime — Emscripten/WASI host environment for blinkenlib.wasm
 *
 * blinkenlib.wasm is an Emscripten-compiled build of the Blink x86-64 emulator.
 * It requires 66 JS imports spanning three namespaces:
 *
 *   wasi_snapshot_preview1.*  – POSIX file I/O and process control
 *   env.__syscall_*           – Linux syscalls Blink forwards when the
 *                               emulated x86-64 code executes a `syscall` insn
 *   env.*                     – Emscripten runtime glue (memory, time, etc.)
 *
 * Execution model
 * ───────────────
 *   1. Allocate space in the WASM heap via malloc()
 *   2. Copy an ELF binary into that allocation
 *   3. Call blinkenlib_start(elf_ptr, elf_size)  → loads and prepares the ELF
 *   4. Call blinkenlib_run_fast()                → runs until exit/crash
 *   5. The emulated program's exit() call reaches proc_exit(), which throws a
 *      sentinel JS exception that we catch to retrieve the exit code
 */

// WASI errno values (returned by fd_* functions on failure)
const W = { OK: 0, EBADF: 8, EINVAL: 28, ENOENT: 44, ENOSYS: 52 };

// Linux errno values (returned by __syscall_* functions as negative ints)
const L = { EPERM: -1, ENOENT: -2, EIO: -5, EBADF: -9, EINVAL: -22, ENOSYS: -38 };

// Sentinel used to propagate exit() through the WASM call stack
const EXIT_TAG = '__blink_exit__';

export class BlinkRuntime {
  constructor() {
    this._inst     = null;   // WebAssembly.Instance (set after instantiate)
    this._mem      = null;   // WebAssembly.Memory   (live view of heap)
    this._exitCode = null;   // set by proc_exit / env.exit
    this._fds      = new Map();
    this._cwd      = '/home/user';

    /** @type {((text: string) => void) | null} */
    this.onStdout = null;
    /** @type {((text: string) => void) | null} */
    this.onStderr = null;
  }

  /* ── Memory helpers ──────────────────────────────────────────────────── */

  u8()  { return new Uint8Array(this._mem.buffer); }
  dv()  { return new DataView(this._mem.buffer); }

  /** Read a null-terminated C string from the WASM heap */
  cstr(ptr) {
    const m = this.u8();
    let s = '';
    while (m[ptr]) s += String.fromCharCode(m[ptr++]);
    return s;
  }

  /* ── Lifecycle ───────────────────────────────────────────────────────── */

  /**
   * Fetch, compile and instantiate blinkenlib.wasm.
   * Throws if the fetch or instantiation fails.
   */
  async load(url = '/assets/blinkenlib.wasm') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);

    const buf  = await resp.arrayBuffer();
    const mod  = await WebAssembly.compile(buf);
    const imp  = this._buildImports();

    // _inst must be set before any import functions are called;
    // __wasm_call_ctors (called below) may invoke imports.
    this._inst = (await WebAssembly.instantiate(mod, imp)).instance;
    this._mem  = this._inst.exports.memory;

    // Run Emscripten's global C++ constructors / module init
    this._inst.exports.__wasm_call_ctors?.();
  }

  /**
   * Execute an ELF binary.
   * @param {Uint8Array} elfBytes
   * @returns {{ exitCode: number, runtime: number, instrCount: number, registers: object|null }}
   */
  async run(elfBytes) {
    if (!this._inst) throw new Error('BlinkRuntime not loaded — call load() first');

    const exp = this._inst.exports;
    this._exitCode = null;

    // Reset standard FDs for this run
    this._fds = new Map([
      [0, { type: 'stdin',  data: new Uint8Array(0), pos: 0 }],
      [1, { type: 'stdout' }],
      [2, { type: 'stderr' }],
    ]);

    // Copy ELF into the WASM heap
    const elfPtr = exp.malloc(elfBytes.length);
    if (!elfPtr) throw new Error('WASM malloc failed — heap exhausted');
    this.u8().set(elfBytes, elfPtr);

    const t0 = performance.now();

    // Load the ELF into the Blink emulator
    const rc = exp.blinkenlib_start(elfPtr, elfBytes.length);
    if (rc !== 0) throw new Error(`blinkenlib_start returned ${rc}`);

    // Run until the emulated program exits.
    // proc_exit / env.exit throw a JS exception to unwind the WASM stack.
    try {
      exp.blinkenlib_run_fast();
    } catch (err) {
      const msg = String(err?.message ?? '');
      if (!msg.startsWith(EXIT_TAG) && this._exitCode === null) throw err;
    }

    return {
      exitCode:   this._exitCode ?? 0,
      runtime:    Math.round(performance.now() - t0),
      instrCount: 0,    // Phase 5: read from clstruct via blinkenlib_get_clstruct()
      registers:  null, // Phase 5: parse clstruct for register values
    };
  }

  /* ── WASI I/O helpers ───────────────────────────────────────────────── */

  /**
   * Implement WASI scatter/gather write (fd_write / fd_pwrite).
   * Reads (base, len) pairs from the iovec array and delivers the text
   * to onStdout / onStderr.
   */
  _iovWrite(fd, iovs_ptr, iovs_len, nwritten_ptr) {
    const dv = this.dv(), u8 = this.u8();
    let total = 0;

    for (let i = 0; i < iovs_len; i++) {
      const base = dv.getUint32(iovs_ptr + i * 8,     true);
      const len  = dv.getUint32(iovs_ptr + i * 8 + 4, true);
      if (!len) continue;

      const text = new TextDecoder().decode(u8.subarray(base, base + len));

      if      (fd === 1) this.onStdout?.(text);
      else if (fd === 2) this.onStderr?.(text);
      // fd >= 3: file write — implement in Phase 6 (VirtualFS integration)

      total += len;
    }

    dv.setUint32(nwritten_ptr, total, true);
    return W.OK;
  }

  /** Implement WASI scatter/gather read (fd_read). */
  _iovRead(fd, iovs_ptr, iovs_len, nread_ptr) {
    const dv   = this.dv(), u8 = this.u8();
    const file = this._fds.get(fd);
    let total  = 0;

    if (file?.type === 'stdin') {
      for (let i = 0; i < iovs_len; i++) {
        const base  = dv.getUint32(iovs_ptr + i * 8,     true);
        const len   = dv.getUint32(iovs_ptr + i * 8 + 4, true);
        const avail = file.data.length - file.pos;
        const n     = Math.min(len, avail);
        u8.set(file.data.subarray(file.pos, file.pos + n), base);
        file.pos += n;
        total    += n;
      }
    }

    dv.setUint32(nread_ptr, total, true);
    return W.OK;
  }

  /* ── Import table ───────────────────────────────────────────────────── */

  _buildImports() {
    const rt = this;

    /**
     * Emscripten invoke_* shim.
     *
     * C++ exception handling in Emscripten works by wrapping every indirect
     * call inside an invoke_* import.  If the callee throws a Wasm exception
     * the shim catches it, marks "threw" via setThrew(), and returns so the
     * Emscripten runtime can re-raise it as a C++ exception.
     *
     * Note: rt._inst is null when _buildImports() runs, but the functions
     * defined here are only *called* after WebAssembly.instantiate() returns
     * and sets rt._inst, so the late binding is safe.
     */
    const invoke = (idx, ...args) => {
      try {
        return rt._inst.exports.__indirect_function_table.get(idx)(...args);
      } catch (e) {
        // Re-throw sentinel exits; swallow everything else
        if (String(e?.message).startsWith(EXIT_TAG)) throw e;
        rt._inst.exports.setThrew?.(1, 0);
      }
    };

    /* ── env namespace ───────────────────────────────────────────────── */
    const env = {

      // ── Indirect call wrappers (Emscripten C++ exceptions) ──────────
      invoke_vi:   (i, a)       => invoke(i, a),
      invoke_vii:  (i, a, b)    => invoke(i, a, b),
      invoke_ji:   (i, a)       => invoke(i, a) ?? 0n,  // returns i64 → BigInt
      invoke_vij:  (i, a, b)    => invoke(i, a, b),

      // ── Process control ──────────────────────────────────────────────
      exit: code => {
        rt._exitCode = code;
        throw new Error(`${EXIT_TAG}${code}`);
      },
      _abort_js: () => { throw new Error('abort()'); },
      _emscripten_throw_longjmp:          () => { throw new Error('longjmp'); },
      _emscripten_runtime_keepalive_clear:() => {},

      // ── Memory ───────────────────────────────────────────────────────
      _emscripten_memcpy_js: (dst, src, n) => rt.u8().copyWithin(dst, src, src + n),

      emscripten_get_heap_max: () => 2147483648, // 2 GiB ceiling

      emscripten_resize_heap: requested => {
        const current = rt._mem.buffer.byteLength;
        if (requested <= current) return 1;
        const pages = Math.ceil((requested - current) / 65536);
        try { rt._mem.grow(pages); return 1; } catch { return 0; }
      },

      // mmap/munmap: allocate anonymous pages from the Emscripten heap
      _mmap_js: (len, _prot, _flags, _fd, _off, allocated_ptr, addr_ptr) => {
        const ptr = rt._inst.exports.malloc(len);
        rt.dv().setUint32(allocated_ptr, 1,   true);
        rt.dv().setUint32(addr_ptr,      ptr, true);
        return 0;
      },
      _munmap_js: () => 0,
      _msync_js:  () => 0,

      // ── Time ─────────────────────────────────────────────────────────
      emscripten_date_now:              () => Date.now(),
      _emscripten_get_now_is_monotonic: () => 1,
      emscripten_get_now:               () => performance.now(),
      emscripten_get_now_res:           () => 1,

      // ── Misc runtime ─────────────────────────────────────────────────
      emscripten_sleep:    () => {},  // no-op; programs that sleep get 0-delay
      emscripten_err: ptr => rt.onStderr?.(rt.cstr(ptr) + '\n'),
      __call_sighandler:   () => {},
      _setitimer_js:       () => 0,
      _tzset_js:           () => {},
      _localtime_js:       () => {},

      // ── Linux syscalls ────────────────────────────────────────────────
      // These are called by the Blink emulator when the emulated x86-64
      // program executes a syscall instruction.  Phase 6 will expand the
      // file-access group to use VirtualFS.

      // Filesystem — working directory
      __syscall_getcwd: (buf, size) => {
        const cwd = rt._cwd;
        if (cwd.length + 1 > size) return L.EINVAL;
        const u8 = rt.u8();
        for (let i = 0; i < cwd.length; i++) u8[buf + i] = cwd.charCodeAt(i);
        u8[buf + cwd.length] = 0;
        return buf; // returns pointer on success (Linux convention)
      },
      __syscall_chdir:     ptr => { rt._cwd = rt.cstr(ptr); return 0; },
      __syscall_fchdir:    ()  => 0,

      // Filesystem — file ops (stub: ENOENT until Phase 6)
      __syscall_openat:     () => L.ENOENT,
      __syscall_stat64:     () => L.ENOENT,
      __syscall_fstat64:    fd => rt._fds.has(fd) ? 0 : L.EBADF,
      __syscall_newfstatat: () => L.ENOENT,
      __syscall_lstat64:    () => L.ENOENT,
      __syscall_getdents64: () => L.ENOENT,
      __syscall_readlinkat: () => L.ENOENT,
      __syscall_mkdirat:    () => 0,
      __syscall_unlinkat:   () => 0,
      __syscall_renameat:   () => 0,
      __syscall_symlinkat:  () => L.ENOSYS,
      __syscall_ftruncate64:() => 0,
      __syscall_utimensat:  () => 0,

      // Filesystem — metadata
      __syscall_fchmod:    () => 0,
      __syscall_chmod:     () => 0,
      __syscall_fchmodat2: () => 0,
      __syscall_fchown32:  () => 0,
      __syscall_fchownat:  () => 0,

      // FD control
      __syscall_ioctl:     () => 0,
      __syscall_fcntl64:   () => 0,
      __syscall_fdatasync: () => 0,
      __syscall_dup:       () => L.ENOSYS,
      __syscall_dup3:      () => L.ENOSYS,
      __syscall_pipe:      () => L.ENOSYS,
      __syscall_poll:      () => 0,

      // Filesystem — volume stats
      __syscall_statfs64:  () => L.ENOSYS,
      __syscall_fstatfs64: () => L.ENOSYS,
    };

    /* ── wasi_snapshot_preview1 namespace ───────────────────────────── */
    const wasi = {
      fd_write:  (fd, iv, n, nw)           => rt._iovWrite(fd, iv, n, nw),
      fd_read:   (fd, iv, n, nr)           => rt._iovRead(fd, iv, n, nr),
      fd_pwrite: (fd, iv, n, _off, nw)     => rt._iovWrite(fd, iv, n, nw),
      fd_pread:  ()                        => W.ENOSYS,

      fd_close: fd => { rt._fds.delete(fd); return W.OK; },
      fd_seek:  ()  => W.ENOSYS,
      fd_sync:  ()  => W.OK,

      fd_fdstat_get: (fd, sp) => {
        if (!rt._fds.has(fd)) return W.EBADF;
        const dv = rt.dv();
        // filetype: 2 = character_device (tty), 4 = regular_file
        dv.setUint8( sp,      fd <= 2 ? 2 : 4);
        dv.setUint16(sp + 2,  0, true);         // flags
        dv.setBigUint64(sp + 8,  0n, true);     // rights_base (unused)
        dv.setBigUint64(sp + 16, 0n, true);     // rights_inheriting
        return W.OK;
      },

      proc_exit: code => {
        rt._exitCode = code;
        throw new Error(`${EXIT_TAG}${code}`);
      },

      environ_sizes_get: (cnt_ptr, sz_ptr) => {
        rt.dv().setUint32(cnt_ptr, 0, true);
        rt.dv().setUint32(sz_ptr,  0, true);
        return W.OK;
      },
      environ_get: () => W.OK,
    };

    return { env, wasi_snapshot_preview1: wasi };
  }
}
