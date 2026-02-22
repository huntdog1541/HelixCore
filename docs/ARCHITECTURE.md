# HelixCore Architecture

## Module Map

```
src/
├── main.js                  Entry — creates App, calls boot()
│
├── engine/
│   ├── AxRuntime.js         ax-x86 WASM host — syscall dispatch, VFS bridge
│   ├── Compiler.js          Compilation pipeline: ASM→ELF, C→ASM→ELF
│   ├── Chibicc.js           Minimal recursive-descent C→GAS/AT&T compiler
│   └── VirtualFS.js         IndexedDB virtual filesystem
│
├── editor/
│   ├── Editor.js            CodeMirror 6 wrapper (syntax, themes, keymaps)
│   └── demoFiles.js         Built-in demo programs (ASM, C, Shell)
│
├── terminal/
│   └── Terminal.js          stdout/stderr display + register panel
│
├── ui/
│   ├── App.js               Root controller — wires all modules
│   ├── Titlebar.js          Logo + tabs + engine status dot
│   ├── Sidebar.js           File tree + RUN button + lang selector
│   └── StatusBar.js         Cursor position + mode + exit code
│
├── utils/
│   ├── EventEmitter.js      Pub/sub for inter-component messaging
│   └── sleep.js             Promise delay
│
└── styles/
    ├── main.css             @imports all sheets
    ├── tokens.css           CSS custom properties (colours, spacing)
    ├── layout.css           CSS Grid layout with drag-resizable panels
    └── components.css       Shared button/panel styles
```

## Compilation Pipeline

```
Language   Stage 1                     Stage 2               Output
─────────────────────────────────────────────────────────────────────
Assembly   @defasm/core                Compiler.assembleGas  ELF
           (AT&T/GAS x86-64 parser)   → hand-built ELF

C          Chibicc.js                 @defasm/core          ELF
           (recursive-descent C→ASM)  Compiler.compileC
                                      → hand-built ELF

Shell      App._runSh()               —                     stdout text
           (line-by-line interpreter)
```

### Hand-Built ELF Layout (single PT_LOAD)

```
Offset 0x000  64 bytes   ELF64 header
Offset 0x040  56 bytes   PT_LOAD program header
Offset 0x078  N  bytes   .text (machine code)
Offset 0x078+N M bytes   .data (string literals, static data)
[in memory]              .bss  (zero-initialised, not in file)

Virtual load base : 0x400000
Entry point       : 0x400000 + 0x078 + offset(_start)
```

## Execution Model

```
ELF bytes
  → AxRuntime.run(elfBytes)
      → Axecutor.from_binary(elfBytes)      ax-x86 parses PT_LOAD segments
      → ax.init_stack_program_start(...)    System V ABI stack setup
      → ax.hook_before_mnemonic(Syscall, handler)
      → ax.execute()                        run until instance.stop()
           ↓ on each syscall instruction
        SyscallHandler(instance)
           RAX=1  write(fd,buf,len)   → onStdout / onStderr callbacks
           RAX=2  open(path,…)        → VirtualFS lookup
           RAX=3  close(fd)           → fd table cleanup
           RAX=9  mmap(…)             → heap extension
           RAX=12 brk(addr)           → bump allocator
           RAX=60 exit(code)          → instance.stop(), record exitCode
           RAX=231 exit_group(code)   → same as exit
           *      unknown             → ENOSYS (-38), continue
```

## Chibicc — Minimal C Compiler

Chibicc is a recursive-descent, single-pass C→AT&T x86-64 compiler. It produces
GAS-compatible assembly that is then assembled by `@defasm/core`.

**Supported language features:**
- Arithmetic operators: `+ - * /`
- Comparison / logical: `== != < <= > >=`
- Declarations: `int x = expr;`
- Control flow: `if / else`, `while`
- Function calls with up to 6 arguments (System V ABI register passing)
- `return` statement, `printf` (via built-in `__printf` stub)

**`__printf` stub (appended to every compiled ELF):**

Instead of calling libc, Chibicc appends a `__printf` subroutine that:
1. Walks the format string byte-by-byte, issuing a `write` syscall per literal character.
2. On `%d`, converts the integer argument to ASCII digits in a stack buffer, then writes.

This keeps the ELF fully self-contained with no dynamic linking.

## Data Flow

```
User types code
  → Editor emits "change" → Sidebar marks file dirty

User presses RUN (or Ctrl+Enter)
  → Sidebar emits "run"
    → App.runProgram(lang, code)
        lang=asm  → Compiler.assembleGas(code)  → { elf, state }
        lang=c    → Compiler.compileC(code)      → { elf, sourceMap }
        lang=sh   → App._runSh(code)             → stdout text (no ELF)
      → AxRuntime.run(elf)
          → onStdout(text) → Terminal.write()
          → onStderr(text) → Terminal.writeErr()
        → Terminal.updateProcessInfo(exitCode, runtime, instrCount)
        → Terminal.updateRegisters(rax, rbx, … rip)
        → StatusBar.setLastExit(code)
```

## Communication Pattern

All inter-component communication goes through `EventEmitter`.
No component holds a direct reference to another —
everything is wired in `App._wireEvents()`.

```
EventEmitter channels
  "run"       Sidebar → App          user pressed RUN
  "change"    Editor  → Sidebar      content changed (dirty flag)
  "open"      Sidebar → Editor       file selected in tree
  "stdout"    AxRuntime → Terminal   process output
  "stderr"    AxRuntime → Terminal   process error output
```

## Panel Layout

The UI is a CSS Grid with five columns:

```
 sidebar │ rsz-l │ editor │ rsz-r │ terminal
 ────────┼───────┼────────┼───────┼──────────
 220px   │  5px  │  1fr   │  5px  │ 300px
```

Column widths are stored in CSS custom properties (`--sidebar-w`, `--terminal-w`)
and updated live during drag operations, allowing the editor to resize without
any JavaScript layout recalculation.

## VirtualFS

Files are stored in IndexedDB (`helixcore-vfs`, object store `files`) and mirrored
into an in-memory `Map` for synchronous-compatible access patterns.

Pre-seeded read-only paths:

| Path               | Content                    |
|--------------------|----------------------------|
| `/proc/version`    | Kernel version string stub |
| `/proc/cpuinfo`    | CPU model string stub      |
| `/etc/hostname`    | `helixcore`                |
| `/etc/os-release`  | OS name / version          |
