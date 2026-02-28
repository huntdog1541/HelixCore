import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Compiler } from '../src/engine/Compiler.js';

vi.mock('../src/engine/AxRuntime.js', () => {
  return {
    AxRuntime: class AxRuntime {
      async run() {
        return {
          exitCode: 0,
          runtime: 1,
          instrCount: 1,
          registers: { rip: '0x0000000000000000' },
          disassembly: [{ va: '0x400078', marker: '▶', bytes: '90', text: 'nop', source: '' }],
          memory: { rip: [], stack: [], heap: [] },
        };
      }
    },
  };
});

vi.mock('../src/engine/VirtualFS.js', () => {
  return {
    VirtualFS: class VirtualFS {},
  };
});

let App;

beforeAll(async () => {
  ({ App } = await import('../src/ui/App.js'));
});

describe('HelixCore smoke tests', () => {
  it('compiles minimal assembly to ELF bytes', () => {
    const compiler = new Compiler();
    const asm = `
.text
.global _start
_start:
    movq $60, %rax
    xorq %rdi, %rdi
    syscall
`;

    const { elf } = compiler.assembleGas(asm);
    expect(elf).toBeInstanceOf(Uint8Array);
    expect(elf.length).toBeGreaterThan(64);
    expect(Compiler.isValidElf(elf)).toBe(true);
  });

  it('forwards disassembly and memory runtime data to terminal renderers', async () => {
    const app = new App({});
    app.compiler = {
      assembleGas: vi.fn(() => ({ elf: new Uint8Array([0x7f, 0x45, 0x4c, 0x46]) })),
    };

    app.engine = {
      run: vi.fn(async () => ({
        exitCode: 0,
        runtime: 2,
        instrCount: 7,
        registers: { rip: '0x0000000000400078' },
        disassembly: [{ va: '0x0000000000400078', marker: '▶', bytes: '90', text: 'nop', source: '' }],
        memory: {
          rip: [{ addr: '0x0000000000400078', hex: '90', ascii: '.' }],
          stack: [{ addr: '0x0000000000000000', hex: '00', ascii: '.' }],
          heap: [{ addr: '0x0000000000800000', hex: '00', ascii: '.' }],
        },
      })),
    };

    app.sidebar = {
      disableRun: vi.fn(),
      enableRun: vi.fn(),
      getLang: vi.fn(() => 'asm'),
    };

    app.editor = {
      getCode: vi.fn(() => '.text\n.global _start\n_start:\n  nop\n'),
      getFile: vi.fn(() => 'hello.asm'),
    };

    app.terminal = {
      clear: vi.fn(),
      system: vi.fn(),
      cmd: vi.fn(),
      success: vi.fn(),
      updateProcessInfo: vi.fn(),
      updateRegisters: vi.fn(),
      updateDisassembly: vi.fn(),
      updateMemory: vi.fn(),
      error: vi.fn(),
    };

    app.titlebar = { setEngineStatus: vi.fn() };
    app.statusbar = { setLastExit: vi.fn() };

    await app.runProgram();

    expect(app.terminal.updateDisassembly).toHaveBeenCalledTimes(1);
    expect(app.terminal.updateMemory).toHaveBeenCalledTimes(1);
    expect(app.statusbar.setLastExit).toHaveBeenCalledWith(0);
  });
});
