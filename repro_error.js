import { Compiler } from './src/engine/Compiler.js';
import { DEMO_FILES } from './src/editor/demoFiles.js';

async function test() {
    const compiler = new Compiler();
    const source = DEMO_FILES['main.c'];
    
    console.log('--- C Source ---');
    console.log(source);
    
    try {
        console.log('\n--- Compiling... ---');
        const { elf, sourceMap } = await compiler.compileC(source);
        console.log('Success! ELF size:', elf.length);
    } catch (err) {
        console.error('\n--- Compilation Error ---');
        console.error(err.message);
    }
}

test();
