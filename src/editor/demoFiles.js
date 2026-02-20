/** Built-in demo programs shown on first load */
export const DEMO_FILES = {
    'main.c': `// HelixCore OS — Hello World in C
// Compiled via Cosmopolitan cosmocc -> x86-64 ELF -> run in ax

#include <stdio.h>

int fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

int main(void) {
    printf("[HelixCore] ax x86-64 Emulator\\n\\n");
    printf("Fibonacci sequence:\\n");
    for (int i = 0; i <= 10; i++) {
        printf("  fib(%2d) = %d\\n", i, fibonacci(i));
    }
    printf("\\n[HelixCore] Process complete. Exit 0.\\n");
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