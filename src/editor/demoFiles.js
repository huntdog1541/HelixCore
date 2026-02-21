/** Built-in demo programs shown on first load */
export const DEMO_FILES = {
    'main.c': `// HelixCore OS — C via chibicc (minimal)
// Compiled via chibicc-js -> x86-64 assembly -> ELF

int main() {
    printf("[HelixCore] Starting chibicc computation...\\n");
    
    int a = 10;
    int b = 20;
    int c = a + b * 2;
    
    printf("Result of a + b * 2 = %d\\n", c);
    
    if (c > 40) {
        printf("Condition (c > 40) is true!\\n");
    } else {
        printf("Condition (c > 40) is false!\\n");
    }
    
    int i = 0;
    while (i < 5) {
        printf("Loop iteration: %d\\n", i);
        i = i + 1;
    }
    
    printf("[HelixCore] Process complete.\\n");
    return 0;
}`,

    'hello.asm': `# HelixCore OS — x86-64 Assembly (GAS/AT&T syntax)
# Assembled in-browser via @defasm/core → ELF → ax emulator

.data
msg:    .ascii "Hello from HelixCore x86-64!\\n"
.equ    msglen, . - msg

.text
.global _start
_start:
    movq $1,         %rax       # sys_write
    movq $1,         %rdi       # fd = stdout
    leaq msg(%rip),  %rsi       # buf = &msg
    movq $msglen,    %rdx       # count
    syscall

    movq $60,        %rax       # sys_exit
    xorq %rdi,       %rdi       # status = 0
    syscall`,

    'shell.sh': `#!/bin/sh
echo "=== HelixCore Shell ==="
echo "Kernel: $(uname -a)"
echo "Done."`,
};