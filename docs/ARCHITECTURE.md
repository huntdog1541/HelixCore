# HelixCore Architecture

## Module Map

```
src/
├── main.js                  Entry — creates App, calls boot()
│
├── engine/
│   ├── BlinkEngine.js       WASM wrapper for blinkenlib (Blink emulator)
│   ├── Compiler.js          WASM compile pipeline (NASM, cosmocc)
│   └── VirtualFS.js         IndexedDB virtual filesystem
│
├── editor/
│   ├── Editor.js            Code editor (textarea + line numbers)
│   └── demoFiles.js         Built-in demo programs
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
    ├── tokens.css           CSS custom properties
    ├── layout.css           Grid layout (titlebar/sidebar/editor/terminal/statusbar)
    └── components.css       Shared button/panel styles
```

## Data Flow

```
User types code
  -> Editor emits "dirty" -> Sidebar marks file dirty

User presses RUN (or Ctrl+Enter)
  -> Sidebar emits "run"
    -> App.runProgram()
      -> BlinkEngine.execute(elfBytes, { sourceCode, lang })
          [demo]  simulated output streamed via onStdout/onStderr
          [wasm]  blinkenlib.wasm executes real x86-64 ELF
        -> Terminal.write() (live streaming)
      -> Terminal.updateProcessInfo(exitCode, runtime, instrCount)
      -> Terminal.updateRegisters(rax, rbx, ... rip)
      -> StatusBar.setLastExit(code)
```

## Communication Pattern

All inter-component communication goes through EventEmitter.
No component holds a direct reference to another —
everything is wired in App._wireEvents().
