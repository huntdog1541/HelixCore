import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxRuntime } from '../src/engine/AxRuntime.js';

// Define constants that would come from ax-x86
const Mnemonic = { Syscall: 746 };
const Register = { RAX: 1, RDI: 6, RSI: 5, RDX: 4, RBX: 2, RCX: 3, RSP: 7, RBP: 8, RIP: 0 };

class MockAxecutor {
    constructor() {}
    static from_binary = vi.fn(() => new MockAxecutor());
    init_stack_program_start = vi.fn();
    hook_before_mnemonic = vi.fn();
    execute = vi.fn(async () => {});
    reg_read_64 = vi.fn((reg) => 0n);
    reg_write_64 = vi.fn();
    mem_read_bytes = vi.fn(() => new Uint8Array());
    commit = vi.fn(() => ({ type: 'commit' }));
    stop = vi.fn(() => ({ type: 'stop' }));
}

// Mock the module before it's imported by AxRuntime.js
vi.mock('ax-x86', () => {
  return {
    default: vi.fn(async () => {}),
    Axecutor: MockAxecutor,
    Mnemonic,
    Register,
    version: vi.fn(() => '0.6.0'),
  };
});

describe('AxRuntime', () => {
  let runtime;

  beforeEach(() => {
    runtime = new AxRuntime();
    vi.clearAllMocks();
  });

  it('should load successfully', async () => {
    const version = await runtime.load();
    expect(version).toBe('0.6.0');
    expect(runtime._initialized).toBe(true);
  });

  it('should throw error if run before load', async () => {
    await expect(runtime.run(new Uint8Array())).rejects.toThrow('AxRuntime not loaded');
  });

  it('should handle write syscall to stdout', async () => {
    await runtime.load();
    const onStdout = vi.fn();
    runtime.onStdout = onStdout;

    const mockAx = new MockAxecutor();
    vi.mocked(MockAxecutor.from_binary).mockReturnValue(mockAx);

    // Capture the hook
    let syscallHook;
    mockAx.hook_before_mnemonic.mockImplementation((mnemonic, cb) => {
      if (mnemonic === Mnemonic.Syscall) syscallHook = cb;
    });

    const runPromise = runtime.run(new Uint8Array([1, 2, 3]));

    // Manually trigger the syscall hook
    // write(fd=1, buf=ptr, len=5)
    mockAx.reg_read_64.mockImplementation((reg) => {
      if (reg === Register.RAX) return 1n; // write
      if (reg === Register.RDI) return 1n; // stdout
      if (reg === Register.RSI) return 0x1000n; // ptr
      if (reg === Register.RDX) return 5n; // len
      return 0n;
    });
    mockAx.mem_read_bytes.mockReturnValue(new TextEncoder().encode('hello'));

    const result = syscallHook(mockAx);
    expect(result).toEqual({ type: 'commit' });
    expect(onStdout).toHaveBeenCalledWith('hello');
    expect(mockAx.reg_write_64).toHaveBeenCalledWith(Register.RAX, 5n);

    // Stop execution
    mockAx.reg_read_64.mockImplementation((reg) => {
        if (reg === Register.RAX) return 60n; // exit
        if (reg === Register.RDI) return 0n; // code
        return 0n;
    });
    syscallHook(mockAx);
    
    await runPromise;
  });

  it('should handle unknown syscall and return ENOSYS', async () => {
    await runtime.load();
    const mockAx = new MockAxecutor();
    vi.mocked(MockAxecutor.from_binary).mockReturnValue(mockAx);

    let syscallHook;
    mockAx.hook_before_mnemonic.mockImplementation((mnemonic, cb) => {
      if (mnemonic === Mnemonic.Syscall) syscallHook = cb;
    });

    const runPromise = runtime.run(new Uint8Array());

    // Trigger unknown syscall 999
    mockAx.reg_read_64.mockImplementation((reg) => {
      if (reg === Register.RAX) return 999n;
      return 0n;
    });

    syscallHook(mockAx);
    
    // ENOSYS is 38. -38 in 64-bit unsigned is 0xffffffffffffffda
    expect(mockAx.reg_write_64).toHaveBeenCalledWith(Register.RAX, 0xffffffffffffffdan);

    // Stop execution
    mockAx.reg_read_64.mockImplementation((reg) => {
        if (reg === Register.RAX) return 60n;
        return 0n;
    });
    syscallHook(mockAx);
    await runPromise;
  });
});
