# HelixCore

A browser-based IDE and OS emulator. Write x86-64 assembly, C, or shell scripts
directly in the browser and run them on a real x86-64 emulator — no server, no
native toolchain required.

---

## What It Is

HelixCore combines a code editor, a virtual filesystem, and an x86-64 execution
engine into a single static web page. Programs run inside
[ax-x86](https://github.com/xarantolus/ax), a Rust→WASM x86-64 emulator, with
system calls (write, open, brk, mmap, exit) handled by a thin JavaScript host
layer. C code is compiled by a built-in recursive-descent compiler (Chibicc) that
produces AT&T x86-64 assembly, which is then assembled into a self-contained ELF
binary by `@defasm/core` — entirely in-browser.

**Supported languages:**

| Language   | Toolchain                              |
|------------|----------------------------------------|
| x86-64 ASM | `@defasm/core` (AT&T/GAS syntax)       |
| C          | Chibicc (built-in) → `@defasm/core`    |
| Shell      | Built-in line interpreter              |

---

## Toolchain

| Tool / Library         | Role                                              |
|------------------------|---------------------------------------------------|
| [Vite](https://vitejs.dev) | Dev server, ESM bundling, production build    |
| [CodeMirror 6](https://codemirror.net) | Code editor with syntax highlighting   |
| [@defasm/core](https://www.npmjs.com/package/@defasm/core) | AT&T x86-64 assembler (browser-native) |
| [ax-x86](https://github.com/xarantolus/ax) | x86-64 emulator (Rust→WASM)        |
| [Vitest](https://vitest.dev) | Unit tests                                  |
| IndexedDB              | Virtual filesystem persistence                    |

---

## Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later

---

## Running a Development Instance

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (hot-reload)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Note:** The dev server sets `Cross-Origin-Opener-Policy: same-origin` and
> `Cross-Origin-Embedder-Policy: require-corp` headers automatically (required
> by the ax-x86 WASM module). These headers are configured in `vite.config.js`.

### Dev Diagnostics (Execution Logging)

In `dev` mode, HelixCore can emit execution diagnostics from `App.runProgram()`.

Captured fields include:
- User IP address (best effort)
- Timestamp
- Command run
- Code being run
- Pre-run snapshot (language, file, command, engine state)
- Final result (or error)

Diagnostics are always logged to the browser console in dev mode under:
`[HelixCore:diagnostics]`

To also send diagnostics to your backend, set Vite env vars:

```bash
VITE_DIAGNOSTICS_ENDPOINT=https://your-api.example.com/helix/diagnostics
VITE_DIAGNOSTICS_IP_ENDPOINT=https://your-ip-service.example.com/ip
```

`VITE_DIAGNOSTICS_IP_ENDPOINT` should return JSON like:

```json
{ "ip": "203.0.113.10" }
```

If no IP endpoint is configured, diagnostics still work and log:
`userIpAddress: "unavailable (set VITE_DIAGNOSTICS_IP_ENDPOINT)"`.

---

## Building for Production

```bash
npm run build       # outputs to dist/
npm run preview     # serve the dist/ build locally
```

---

## Running Tests

### Unit Tests

```bash
npm test
```

Vitest runs in watch mode by default. To run once and exit:

```bash
npm test -- --run
```

#### Test Coverage

| File                         | What it tests                              |
|------------------------------|--------------------------------------------|
| `tests/AxRuntime.test.js`    | Syscall dispatch, stdout/stderr callbacks, ENOSYS fallback |

Tests use Vitest's `vi.mock` to stub the `ax-x86` WASM module so they run
in Node without a browser environment.

### Integration & Debugging Scripts

These scripts run directly with Node.js to verify the compiler and assembler logic outside of the browser environment.

#### Assembler Instruction Test
Verifies that specific x86-64 instructions are correctly handled by the `@defasm/core` assembler.
```bash
node test_assembler.js
```

#### Compilation Reproducer
Compiles the `main.c` demo file to ELF and generates a `compilation.log` with detailed assembly and mapping information.
```bash
node repro_error.js
```

---

## Project Structure

```
HelixCore/
├── src/
│   ├── main.js              Entry point
│   ├── engine/
│   │   ├── AxRuntime.js     ax-x86 host (syscalls, VFS bridge)
│   │   ├── Compiler.js      ASM→ELF and C→ELF pipeline
│   │   ├── Chibicc.js       Minimal C→AT&T x86-64 compiler
│   │   └── VirtualFS.js     IndexedDB virtual filesystem
│   ├── editor/
│   │   ├── Editor.js        CodeMirror 6 integration
│   │   └── demoFiles.js     Built-in example programs
│   ├── terminal/
│   │   └── Terminal.js      Output display + register viewer
│   ├── ui/
│   │   ├── App.js           Root controller
│   │   ├── Titlebar.js      Header bar
│   │   ├── Sidebar.js       File tree + controls
│   │   └── StatusBar.js     Status line
│   ├── utils/
│   │   ├── EventEmitter.js  Pub/sub messaging
│   │   └── sleep.js         Promise delay helper
│   └── styles/              CSS (grid layout, tokens, components)
├── tests/                   Vitest unit tests
├── docs/
│   └── ARCHITECTURE.md      Detailed architecture reference
├── vite.config.js
└── package.json
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a detailed breakdown of the
compilation pipeline, execution model, data flow, and component communication.

---

## License

See [LICENSE](LICENSE).
