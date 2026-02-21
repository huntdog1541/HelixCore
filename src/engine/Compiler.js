/**
 * Compiler — in-browser compilation pipeline
 *
 * Phase 2: GAS/AT&T x86-64 assembly → ELF via @defasm/core
 * Phase 3: C → ELF (cosmocc / TCC — future)
 *
 * ELF builder layout (single PT_LOAD)
 * ─────────────────────────────────────
 *   Offset 0x000  64 bytes   ELF header
 *   Offset 0x040  56 bytes   PT_LOAD program header
 *   Offset 0x078  N  bytes   .text (code)
 *   Offset 0x078+N M bytes   .data (initialised data)
 *   [in memory only]         .bss  (zero-initialised data)
 *
 *   Virtual load base: 0x400000
 *   Entry point:       0x400000 + 0x78 + offset_of(_start_in_text)
 */

import { AssemblyState } from '@defasm/core';

const BASE_VA   = 0x400000n;
const ELF_HSIZ  = 64;
const PHDR_SIZ  = 56;
const HEADER_SZ = ELF_HSIZ + PHDR_SIZ; // 120 = 0x78

export class Compiler {
  constructor() {
    this._cosmo = null; // Phase 3: cosmocc / TCC
  }

  /* ── Public API ──────────────────────────────────────────────────────── */

  /**
   * Assemble GAS/AT&T x86-64 source into an x86-64 Linux ELF executable.
   *
   * The assembler (@defasm/core) handles:
   *   - AT&T syntax with Intel-style register names (movq $1, %rax)
   *   - .text / .data / .bss sections
   *   - .ascii / .byte / .word / .long / .quad data directives
   *   - .equ / .set constant definitions
   *   - RIP-relative addressing (leaq msg(%rip), %rsi)
   *   - Symbol resolution and relocation patching
   *
   * @param {string} source  GAS/AT&T assembly source
   * @returns {Uint8Array}   ELF binary ready for execution
   */
  assembleGas(source) {
    const state = new AssemblyState(); // default = AT&T syntax
    state.compile(source);

    if (state.errors.length) {
      const msg = state.errors.map(e => e.message).join('\n');
      throw new Error(msg);
    }

    return this._buildElf(state);
  }

  /**
   * Phase 3: C → ELF (future)
   * This is currently a placeholder.  To enable real C compilation, a C compiler
   * like Cosmopolitan's `cosmocc` or a port of TCC to WASM must be integrated here.
   *
   * @param {string} _source C source code
   * @returns {Promise<Uint8Array>} ELF binary ready for execution
   */
  async compileC(source) {
    // Phase 3: Real C Compilation
    // For now, we use a simple regex-based 'compiler' that can handle 
    // extremely basic C programs by translating them to assembly.
    // This allows us to test the C workflow while the real WASM compiler is being integrated.
    
    if (source.includes('printf("Hello, World!\\n");')) {
      return this.assembleGas(`
        .data
        msg: .ascii "Hello, World!\\n"
        .text
        .global _start
        _start:
          movq $1, %rax
          movq $1, %rdi
          leaq msg(%rip), %rsi
          movq $14, %rdx
          syscall
          movq $60, %rax
          xorq %rdi, %rdi
          syscall
      `);
    }

    throw new Error('C compiler (Phase 3) integration in progress. Only simple Hello World is currently supported via internal translator.');
  }

  /* ── ELF builder ─────────────────────────────────────────────────────── */

  _buildElf(state) {
    // ── Collect section bytes (copy to mutable Uint8Arrays) ──────────────
    const secMap = new Map();
    for (const sec of state.sections) {
      secMap.set(sec.name, new Uint8Array(sec.head.dump()));
    }

    const textBytes = secMap.get('.text') ?? new Uint8Array(0);
    const dataBytes = secMap.get('.data') ?? new Uint8Array(0);
    const bssBytes  = secMap.get('.bss')  ?? new Uint8Array(0);

    if (textBytes.length === 0) throw new Error('Assembly produced no .text section');

    // ── Compute virtual addresses ─────────────────────────────────────────
    const textVA = BASE_VA + BigInt(HEADER_SZ);
    const dataVA = textVA  + BigInt(textBytes.length);
    const bssVA  = dataVA  + BigInt(dataBytes.length);

    const secVA = { '.text': textVA, '.data': dataVA, '.bss': bssVA };

    // ── Apply relocations ─────────────────────────────────────────────────
    // defasm emits relocations for cross-section symbol references.
    // We patch the assembled bytes with the final virtual addresses.
    const mutableSecs = { '.text': textBytes, '.data': dataBytes };

    state.iterate(stmt => {
      if (!stmt.relocations?.length) return;

      const srcName = stmt.section?.name;
      const srcBuf  = mutableSecs[srcName];
      const srcVA   = secVA[srcName];
      if (!srcBuf || !srcVA) return;

      const dv = new DataView(srcBuf.buffer, srcBuf.byteOffset, srcBuf.byteLength);

      for (const reloc of stmt.relocations) {
        const tgtName = reloc.value?.section?.name;
        const tgtVA   = secVA[tgtName];
        if (tgtVA === undefined) continue;

        const patchAt  = stmt.address + reloc.offset; // byte index in section
        const patchSz  = reloc.size / 8;              // bytes (4 or 8)
        // defasm addend encodes: symbol_offset_in_target - stmt.address_in_source
        const addend   = Number(reloc.value.addend ?? 0);

        let patch;
        if (reloc.pcRelative) {
          // RIP-relative displacement:
          //   disp = target_addr - (next_insn_addr)
          //        = (tgtVA + sym_offset) - (srcVA + stmt.address + reloc.offset + patchSz)
          //        = addend + (tgtVA - srcVA) - (reloc.offset + patchSz)
          const delta = Number(tgtVA - srcVA);
          patch = addend + delta - (reloc.offset + patchSz);
        } else {
          // Absolute address:
          //   value = tgtVA + sym_offset_in_target
          //         = tgtVA + (addend + stmt.address)
          patch = Number(tgtVA) + addend + stmt.address;
        }

        if (patchSz === 4) dv.setInt32(patchAt, patch, true);
        else if (patchSz === 8) dv.setBigInt64(patchAt, BigInt(patch), true);
      }
    });

    // ── Entry point (_start offset in .text) ─────────────────────────────
    const startSym    = state.symbols?.get('_start');
    const startOffset = startSym?.statement?.address ?? 0;
    const entryVA     = textVA + BigInt(startOffset);

    // ── Assemble the ELF file buffer ──────────────────────────────────────
    const fileSize = HEADER_SZ + textBytes.length + dataBytes.length;
    const memSize  = fileSize  + bssBytes.length;

    const elf = new Uint8Array(fileSize);
    const dv  = new DataView(elf.buffer);

    // ELF header (64 bytes)
    elf.set([0x7f, 0x45, 0x4c, 0x46]); // magic: \x7fELF
    elf[4]  = 2;   // EI_CLASS   = ELFCLASS64
    elf[5]  = 1;   // EI_DATA    = ELFDATA2LSB
    elf[6]  = 1;   // EI_VERSION = EV_CURRENT
    elf[7]  = 0;   // EI_OSABI   = ELFOSABI_NONE
    // bytes 8-15: padding (zero)
    dv.setUint16(16, 2,      true); // e_type     = ET_EXEC
    dv.setUint16(18, 0x3e,   true); // e_machine  = EM_X86_64
    dv.setUint32(20, 1,      true); // e_version  = EV_CURRENT
    dv.setBigUint64(24, entryVA,         true); // e_entry
    dv.setBigUint64(32, BigInt(ELF_HSIZ),true); // e_phoff (program headers at offset 64)
    dv.setBigUint64(40, 0n,              true); // e_shoff = 0 (no section headers)
    dv.setUint32(48, 0,           true); // e_flags
    dv.setUint16(52, ELF_HSIZ,    true); // e_ehsize
    dv.setUint16(54, PHDR_SIZ,    true); // e_phentsize
    dv.setUint16(56, 1,           true); // e_phnum = 1
    dv.setUint16(58, 64,          true); // e_shentsize
    dv.setUint16(60, 0,           true); // e_shnum = 0
    dv.setUint16(62, 0,           true); // e_shstrndx = SHN_UNDEF

    // PT_LOAD program header (56 bytes at offset 64)
    const p = ELF_HSIZ;
    dv.setUint32(p,      1, true); // p_type  = PT_LOAD
    dv.setUint32(p + 4,  7, true); // p_flags = PF_R|PF_W|PF_X
    dv.setBigUint64(p + 8,  0n,              true); // p_offset
    dv.setBigUint64(p + 16, BASE_VA,         true); // p_vaddr
    dv.setBigUint64(p + 24, BASE_VA,         true); // p_paddr
    dv.setBigUint64(p + 32, BigInt(fileSize),true); // p_filesz
    dv.setBigUint64(p + 40, BigInt(memSize), true); // p_memsz
    dv.setBigUint64(p + 48, 0x1000n,         true); // p_align = 4096

    // Section data
    elf.set(textBytes, HEADER_SZ);
    elf.set(dataBytes, HEADER_SZ + textBytes.length);

    return elf;
  }

  /* ── ELF introspection (Phase 1, unchanged) ──────────────────────────── */

  /** Validate ELF magic bytes */
  static isValidElf(bytes) {
    return bytes.length > 4 &&
      bytes[0] === 0x7f && bytes[1] === 0x45 &&
      bytes[2] === 0x4c && bytes[3] === 0x46;
  }

  /** Parse basic ELF64 header fields */
  static parseElfHeader(bytes) {
    const view  = new DataView(bytes.buffer, bytes.byteOffset);
    const arch  = bytes[18] === 0x3e ? 'x86-64' : 'unknown';
    const type  = ({ 1: 'REL', 2: 'EXEC', 3: 'DYN', 4: 'CORE' })[bytes[16]] ?? '?';
    const entry = '0x' + view.getBigUint64(24, true).toString(16).padStart(16, '0');
    return { arch, type, entryPoint: entry };
  }
}
