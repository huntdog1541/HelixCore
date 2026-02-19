/** Built-in demo programs shown on first load */
export const DEMO_FILES = {
    'main.c': `// HelixCore OS — Hello World in C
// Compiled via Cosmopolitan cosmocc -> x86-64 ELF -> run in Blink

#include <stdio.h>

int fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

int main(void) {
    printf("[HelixCore] Blink x86-64 Emulator\\n\\n");
    printf("Fibonacci sequence:\\n");
    for (int i = 0; i <= 10; i++) {
        printf("  fib(%2d) = %d\\n", i, fibonacci(i));
    }
    printf("\\n[HelixCore] Process complete. Exit 0.\\n");
    return 0;
}`,

    'hello.asm': `; HelixCore OS — x86-64 Assembly
; nasm -f elf64 hello.asm && ld -o hello hello.o && blink ./hello

section .data
    msg db "Hello from HelixCore x86-64!", 10
    len equ $ - msg

section .text
global _start
_start:
    mov rax, 1
    mov rdi, 1
    mov rsi, msg
    mov rdx, len
    syscall
    mov rax, 60
    xor rdi, rdi
    syscall`,

    'shell.sh': `#!/bin/sh
echo "=== HelixCore Shell ==="
echo "Kernel: $(uname -a)"
echo "Done."`,
};