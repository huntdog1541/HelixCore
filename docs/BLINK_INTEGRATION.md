# Blink WASM Integration Guide

## Step 1: Get blinkenlib.wasm

```bash
git clone https://github.com/robalb/x86-64-playground
cp x86-64-playground/webapp/assets/blinkenlib.wasm ./public/assets/
cp x86-64-playground/webapp/assets/blinkenlib.js   ./public/assets/
```

## Step 2: Uncomment the WASM loader in BlinkEngine.js

In `src/engine/BlinkEngine.js`, find the `load()` method and uncomment
the WASM import block. Then wire up `vm.run()` in `execute()`.

## Step 3: Serve with correct headers

WASM + SharedArrayBuffer requires:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
These are pre-configured in `vite.config.js`.

## blinkenlib API

```javascript
const blink = await initBlink('/assets/blinkenlib.wasm');
const vm    = blink.createVM();

vm.loadElf(uint8ArrayElfBytes);
vm.onStdout = (chunk) => terminal.write(chunk);
vm.onStderr = (chunk) => terminal.error(chunk);

const result = vm.run({ args: ['./prog'], env: {} });
// result.exitCode, result.runtimeMs, result.instructionCount

const regs = vm.getRegisters();
// regs.rax, regs.rbx, regs.rip, ...
```