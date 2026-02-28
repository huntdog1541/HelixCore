import { AssemblyState } from '@defasm/core';

const tests = [
    'movzbq %al, %rax',
    'movzbl %al, %eax',
    'movzbl (%r12), %ebx',
    'setg %al',
    'setl %al',
    'imulq %rdi, %rax',
    'negq %rax',
    'testq %rbx, %rbx',
    'incq %r12',
    'decq %rcx'
];

for (const code of tests) {
    const state = new AssemblyState();
    try {
        state.compile('.text\n' + code);
        if (state.errors.length) {
            console.log(`FAIL: [${code}] - ${state.errors[0].message}`);
        } else {
            console.log(`PASS: [${code}]`);
        }
    } catch (e) {
        console.log(`CRASH: [${code}] - ${e.message}`);
    }
}
