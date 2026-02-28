import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/engine/Compiler.js';
import { AxRuntime } from '../src/engine/AxRuntime.js';
import { VirtualFS } from '../src/engine/VirtualFS.js';

describe('HelixCore End-to-End Smoke Test', () => {
  it('should compile and run a simple C program', async () => {
    const vfs = new VirtualFS();
    // In-memory only for this test, no IndexedDB needed if we don't call open()
    // or we can mock indexedDB. vitest environment should have fake-indexeddb from devDeps.

    const compiler = new Compiler();
    const runtime = new AxRuntime();
    runtime.vfs = vfs;

    // A simple C program that prints something and returns
    // Based on Chibicc.js, it supports simple assignments and printf
    const cSource = `
      int main() {
        printf("Hello from HelixCore\\n");
        return 0;
      }
    `;

    // 1. Compile C to ELF
    const { elf } = await compiler.compileC(cSource);
    expect(elf).toBeInstanceOf(Uint8Array);
    expect(elf.length).toBeGreaterThan(64); // Header size

    // 2. Run ELF in Runtime
    await runtime.load();
    let output = '';
    runtime.onStdout = (chunk) => {
      output += chunk;
    };

    const result = await runtime.run(elf);

    // 3. Verify output
    // Note: Chibicc.js currently wraps statements in _start but returns 0 via syscall 60.
    // Let's check the output and exit code.
    expect(output).toContain('Hello from HelixCore');
    expect(result.exitCode).toBe(0);
  });

  it('should compile and run assembly directly', async () => {
    const compiler = new Compiler();
    const runtime = new AxRuntime();

    // Assembly that exits with 42
    const asmSource = `
.text
.global _start
_start:
    movq $60, %rax
    movq $42, %rdi
    syscall
`;

    const { elf } = compiler.assembleGas(asmSource);
    await runtime.load();
    const result = await runtime.run(elf);

    expect(result.exitCode).toBe(42);
  });
});
