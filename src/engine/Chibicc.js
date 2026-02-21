/**
 * Chibicc.js — Minimal C compiler (recursive descent) for x86-64
 * 
 * Ported from a tiny subset of rui314/chibicc's architecture.
 * This handles basic arithmetic, local variables, if/else, for/while,
 * and external function calls (like printf).
 * 
 * It produces GAS/AT&T x86-64 assembly.
 */

export class Chibicc {
  constructor() {
    this.tokens = [];
    this.pos = 0;
    this.locals = new Map();
    this.stackOffset = 0;
    this.labelId = 0;
  }

  compile(source) {
    this.tokens = this._tokenize(source);
    this.pos = 0;
    this.locals.clear();
    this.stackOffset = 0;
    this.labelId = 0;
    this._sourceMap = []; // [{ asmLine: number, srcLine: number, srcCol: number }]

    let asm = '.data\n';
    // We'll collect string literals here
    const strings = [];
    
    // Quick scan for string literals to put in .data
    // This is a bit hacky, but works for a minimal compiler
    const stringRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let match;
    let strId = 0;
    const stringMap = new Map();
    while ((match = stringRegex.exec(source)) !== null) {
      if (!stringMap.has(match[0])) {
        const label = `.L.str.${strId++}`;
        stringMap.set(match[0], label);
        // Replace \n with real newline or hex
        const content = match[1].replace(/\\n/g, '\\n');
        asm += `${label}: .ascii "${content}\\0"\n`;
      }
    }
    // Store for use by _getStrLabel() during code generation
    this._stringMap = stringMap;

    asm += '.text\n.global _start\n_start:\n';
    
    // We'll wrap everything in a 'main' but the entry point is _start
    // Actually, we'll just parse top-level statements for now
    // and assume they form the body of _start.
    
    // Standard function prologue for _start
    asm += '  pushq %rbp\n';
    asm += '  movq %rsp, %rbp\n';
    
    // We need to know the total stack size for locals
    // We'll parse first to find all locals, then emit the subq $N, %rsp
    const nodes = [];
    while (!this._atEnd()) {
      nodes.push(this._stmt());
    }
    
    // Padded to 16-byte alignment
    const stackSize = (this.stackOffset + 15) & ~15;
    if (stackSize > 0) {
      asm += `  subq $${stackSize}, %rsp\n`;
    }

    const currentAsmLine = () => asm.split('\n').length;

    // Generate code for each statement
    for (const node of nodes) {
      if (node.line) {
        this._sourceMap.push({ asmLine: currentAsmLine(), srcLine: node.line, srcCol: node.col });
      }
      asm += this._gen(node);
      // After each statement, we might have a value on the stack, pop it
      if (node.type !== 'if' && node.type !== 'while' && node.type !== 'for' && node.type !== 'block' && node.type !== 'return' && node.type !== 'nop') {
         asm += '  popq %rax\n';
      }
    }

    // Standard epilogue and exit syscall (since we don't have crt0)
    asm += '.L.exit:\n';
    asm += '  movq %rbp, %rsp\n';
    asm += '  popq %rbp\n';
    asm += '  movq $60, %rax\n';
    asm += '  xorq %rdi, %rdi\n';
    asm += '  syscall\n';

    // Append the __printf helper (used by any printf call in user code)
    asm += this._printfStub();

    return { assembly: asm, sourceMap: this._sourceMap };
  }

  /* ── Tokenizer ────────────────────────────────────────────────────────── */

  _tokenize(source) {
    const tokens = [];
    const regex = /\s*(?:\/\/.*|\/\*[\s\S]*?\*\/|([a-zA-Z_]\w*)|(\d+)|(".*?")|(==|!=|<=|>=|&&|\|\||[{}()\[\],;=+\-*\/&!%<>\^|~.?:]))/g;
    
    let m;
    while ((m = regex.exec(source)) !== null) {
      const fullMatch = m[0];
      const leadingWhitespace = fullMatch.match(/^\s*/)[0];
      const index = m.index + leadingWhitespace.length;
      
      const textBefore = source.substring(0, index);
      const matches = textBefore.match(/\n/g);
      const line = matches ? matches.length + 1 : 1;
      const lastNL = textBefore.lastIndexOf('\n');
      const col = lastNL === -1 ? index : index - lastNL - 1;

      const tokenData = { line, col };
      if (m[1]) tokens.push({ type: 'ident', val: m[1], ...tokenData });
      else if (m[2]) tokens.push({ type: 'num', val: parseInt(m[2]), ...tokenData });
      else if (m[3]) tokens.push({ type: 'str', val: m[3], ...tokenData });
      else if (m[4]) tokens.push({ type: 'punct', val: m[4], ...tokenData });
    }
    return tokens;
  }

  /* ── Parser ───────────────────────────────────────────────────────────── */

  _atEnd() { return this.pos >= this.tokens.length; }
  _peek() { return this.tokens[this.pos]; }
  _consume() { return this.tokens[this.pos++]; }
  _match(val) {
    if (this._atEnd() || this._peek().val !== val) return false;
    this.pos++;
    return true;
  }
  _expect(val) {
    if (val === 'ident') {
       if (!this._atEnd() && this._peek().type === 'ident') return this._consume();
       throw new Error(`Expected identifier at token ${this.pos}`);
    }
    if (!this._match(val)) throw new Error(`Expected '${val}' at token ${this.pos}`);
  }

  _stmt() {
    const startTok = this._peek();
    // Skip #include directives
    if (this._peek()?.val === '#') {
       while(!this._atEnd() && this._consume().val !== ';'); // Simple skip until ; or newline? 
       // Lexer doesn't handle # well. Let's fix tokenizer.
    }
    if (this._peek()?.val === 'int' && this.tokens[this.pos+1]?.type === 'ident' && this.tokens[this.pos+2]?.val === '(') {
       this._expect('int');
       this._expect('ident'); // main
       this._expect('(');
       if (this._match('void')) {}
       this._expect(')');
       return this._stmt();
    }

    if (this._match('if')) {
      this._expect('(');
      const cond = this._expr();
      this._expect(')');
      const then = this._stmt();
      let els = null;
      if (this._match('else')) els = this._stmt();
      return { type: 'if', cond, then, els, line: startTok.line, col: startTok.col };
    }
    
    if (this._match('while')) {
      this._expect('(');
      const cond = this._expr();
      this._expect(')');
      const body = this._stmt();
      return { type: 'while', cond, body, line: startTok.line, col: startTok.col };
    }

    if (this._match('{')) {
      const stmts = [];
      while (!this._match('}')) stmts.push(this._stmt());
      return { type: 'block', stmts, line: startTok.line, col: startTok.col };
    }

    // Type declarations (minimal: int x = 5;)
    if (this._match('int')) {
      // Skip optional * for pointers (minimal support)
      while(this._match('*'));
      const nameTok = this._expect('ident');
      const name = nameTok.val;
      if (!this.locals.has(name)) {
        this.stackOffset += 8;
        this.locals.set(name, -this.stackOffset);
      }
      if (this._match('=')) {
        const val = this._expr();
        this._expect(';');
        return { type: 'assign', name, val, line: startTok.line, col: startTok.col };
      }
      this._expect(';');
      return { type: 'nop', line: startTok.line, col: startTok.col };
    }

    if (this._match('return')) {
      const val = this._expr();
      this._expect(';');
      return { type: 'return', val, line: startTok.line, col: startTok.col };
    }

    const e = this._expr();
    this._expect(';');
    return e;
  }

  _expr() { return this._assign(); }

  _assign() {
    const startTok = this._peek();
    let node = this._equality();
    if (this._match('=')) {
      if (node.type !== 'var') throw new Error('Left side of assignment must be a variable');
      node = { type: 'assign', name: node.name, val: this._assign(), line: startTok.line, col: startTok.col };
    }
    return node;
  }

  _equality() {
    let node = this._relational();
    for (;;) {
      if (this._match('==')) node = { type: 'binary', op: '==', left: node, right: this._relational(), line: node.line, col: node.col };
      else if (this._match('!=')) node = { type: 'binary', op: '!=', left: node, right: this._relational(), line: node.line, col: node.col };
      else return node;
    }
  }

  _relational() {
    let node = this._add();
    for (;;) {
      if (this._match('<')) node = { type: 'binary', op: '<', left: node, right: this._add(), line: node.line, col: node.col };
      else if (this._match('>')) node = { type: 'binary', op: '>', left: node, right: this._add(), line: node.line, col: node.col };
      else if (this._match('<=')) node = { type: 'binary', op: '<=', left: node, right: this._add(), line: node.line, col: node.col };
      else if (this._match('>=')) node = { type: 'binary', op: '>=', left: node, right: this._add(), line: node.line, col: node.col };
      else return node;
    }
  }

  _add() {
    let node = this._mul();
    for (;;) {
      if (this._match('+')) node = { type: 'binary', op: '+', left: node, right: this._mul(), line: node.line, col: node.col };
      else if (this._match('-')) node = { type: 'binary', op: '-', left: node, right: this._mul(), line: node.line, col: node.col };
      else return node;
    }
  }

  _mul() {
    let node = this._unary();
    for (;;) {
      if (this._match('*')) node = { type: 'binary', op: '*', left: node, right: this._unary(), line: node.line, col: node.col };
      else if (this._match('/')) node = { type: 'binary', op: '/', left: node, right: this._unary(), line: node.line, col: node.col };
      else return node;
    }
  }

  _unary() {
    const startTok = this._peek();
    if (this._match('+')) return this._primary();
    if (this._match('-')) return { type: 'binary', op: '-', left: { type: 'num', val: 0, line: startTok.line, col: startTok.col }, right: this._primary(), line: startTok.line, col: startTok.col };
    return this._primary();
  }

  _primary() {
    const t = this._consume();
    if (t.val === '(') {
      const node = this._expr();
      this._expect(')');
      return node;
    }
    if (t.type === 'num') return { type: 'num', val: t.val, line: t.line, col: t.col };
    if (t.type === 'str') return { type: 'str', val: t.val, line: t.line, col: t.col };
    if (t.type === 'ident') {
      // Function call?
      if (this._match('(')) {
        const args = [];
        if (!this._match(')')) {
          args.push(this._expr());
          while (this._match(',')) args.push(this._expr());
          this._expect(')');
        }
        return { type: 'call', name: t.val, args, line: t.line, col: t.col };
      }
      // Variable
      return { type: 'var', name: t.val, line: t.line, col: t.col };
    }
    throw new Error(`Unexpected token: ${t.val}`);
  }

  /* ── Code Generator ───────────────────────────────────────────────────── */

  _gen(node) {
    let asm = '';
    switch (node.type) {
      case 'num':
        asm += `  pushq $${node.val}\n`;
        break;
      case 'str':
        asm += `  leaq ${this._getStrLabel(node.val)}(%rip), %rax\n`;
        asm += '  pushq %rax\n';
        break;
      case 'var':
        asm += `  movq ${this.locals.get(node.name)}(%rbp), %rax\n`;
        asm += '  pushq %rax\n';
        break;
      case 'assign':
        asm += this._gen(node.val);
        asm += '  popq %rax\n';
        asm += `  movq %rax, ${this.locals.get(node.name)}(%rbp)\n`;
        asm += '  pushq %rax\n';
        break;
      case 'binary':
        asm += this._gen(node.left);
        asm += this._gen(node.right);
        asm += '  popq %rdi\n';
        asm += '  popq %rax\n';
        switch (node.op) {
          case '+': asm += '  addq %rdi, %rax\n'; break;
          case '-': asm += '  subq %rdi, %rax\n'; break;
          case '*': asm += '  imulq %rdi, %rax\n'; break;
          case '/': asm += '  cqo\n  idivq %rdi\n'; break;
          case '==': asm += '  cmpq %rdi, %rax\n  sete %al\n  movzbq %al, %rax\n'; break;
          case '!=': asm += '  cmpq %rdi, %rax\n  setne %al\n  movzbq %al, %rax\n'; break;
          case '<':  asm += '  cmpq %rdi, %rax\n  setl %al\n  movzbq %al, %rax\n'; break;
          case '<=': asm += '  cmpq %rdi, %rax\n  setle %al\n  movzbq %al, %rax\n'; break;
          case '>':  asm += '  cmpq %rdi, %rax\n  setg %al\n  movzbq %al, %rax\n'; break;
          case '>=': asm += '  cmpq %rdi, %rax\n  setge %al\n  movzbq %al, %rax\n'; break;
        }
        asm += '  pushq %rax\n';
        break;
      case 'call':
        // We only support up to 6 args in registers (SysV ABI)
        const regs = ['%rdi', '%rsi', '%rdx', '%rcx', '%r8', '%r9'];
        for (let i = 0; i < node.args.length; i++) {
          asm += this._gen(node.args[i]);
        }
        for (let i = node.args.length - 1; i >= 0; i--) {
          asm += `  popq ${regs[i]}\n`;
        }
        // Handle printf specially if it's the only one
        if (node.name === 'printf') {
           asm += '  xorq %rax, %rax\n';
           asm += '  call __printf\n';
        } else {
           asm += `  call ${node.name}\n`;
        }
        asm += '  pushq %rax\n';
        break;
      case 'if':
        const id = this.labelId++;
        asm += this._gen(node.cond);
        asm += '  popq %rax\n';
        asm += '  cmpq $0, %rax\n';
        asm += `  je .L.else.${id}\n`;
        asm += this._gen(node.then);
        asm += `  jmp .L.end.${id}\n`;
        asm += `.L.else.${id}:\n`;
        if (node.els) asm += this._gen(node.els);
        asm += `.L.end.${id}:\n`;
        break;
      case 'while':
        const wid = this.labelId++;
        asm += `.L.begin.${wid}:\n`;
        asm += this._gen(node.cond);
        asm += '  popq %rax\n';
        asm += '  cmpq $0, %rax\n';
        asm += `  je .L.end.${wid}\n`;
        asm += this._gen(node.body);
        asm += `  jmp .L.begin.${wid}\n`;
        asm += `.L.end.${wid}:\n`;
        break;
      case 'block':
        for (const s of node.stmts) {
          asm += this._gen(s);
          if (s.type !== 'if' && s.type !== 'while' && s.type !== 'for' && s.type !== 'block' && s.type !== 'return' && s.type !== 'nop') {
            asm += '  popq %rax\n';
          }
        }
        break;
      case 'return':
        asm += this._gen(node.val);
        asm += '  popq %rax\n';
        asm += '  jmp .L.exit\n';
        break;
      case 'nop':
        break;
    }
    return asm;
  }

  // Return the .data label for a quoted string literal (e.g. '"Hello\n"' → '.L.str.0')
  // Uses the same stringMap built during compile() so IDs are always consistent.
  _getStrLabel(val) {
    return this._stringMap?.get(val) ?? '.L.str.0';
  }

  // Emit a minimal __printf subroutine that implements printf via write syscalls.
  // Supports: literal characters and the %d conversion specifier.
  // Calling convention: %rdi = fmt (null-terminated), %rsi = first integer arg.
  _printfStub() {
    return `
__printf:
  pushq %rbp
  movq  %rsp, %rbp
  pushq %rbx
  pushq %r12
  pushq %r13
  subq  $32, %rsp
  movq  %rdi, %r12
  movq  %rsi, %r13
.L.pf_loop:
  movzbq (%r12), %rbx
  testq  %rbx, %rbx
  jz     .L.pf_done
  cmpq   $37, %rbx
  je     .L.pf_spec
  movq   $1,   %rax
  movq   $1,   %rdi
  movq   %r12, %rsi
  movq   $1,   %rdx
  syscall
  incq   %r12
  jmp    .L.pf_loop
.L.pf_spec:
  incq   %r12
  movzbq (%r12), %rbx
  incq   %r12
  cmpq   $100, %rbx
  jne    .L.pf_loop
  movq   %r13, %rax
  testq  %rax, %rax
  jns    .L.pf_pos
  subq   $8,  %rsp
  movb   $45, (%rsp)
  movq   $1,  %rax
  movq   $1,  %rdi
  movq   %rsp, %rsi
  movq   $1,  %rdx
  syscall
  addq   $8,  %rsp
  movq   %r13, %rax
  negq   %rax
.L.pf_pos:
  leaq   -25(%rbp), %rcx
.L.pf_dloop:
  xorq   %rdx, %rdx
  movq   $10,  %rbx
  divq   %rbx
  addq   $48,  %rdx
  movb   %dl,  (%rcx)
  decq   %rcx
  testq  %rax, %rax
  jnz    .L.pf_dloop
  incq   %rcx
  leaq   -24(%rbp), %rdx
  subq   %rcx, %rdx
  movq   $1,   %rax
  movq   $1,   %rdi
  movq   %rcx, %rsi
  syscall
  jmp    .L.pf_loop
.L.pf_done:
  addq   $32, %rsp
  popq   %r13
  popq   %r12
  popq   %rbx
  movq   %rbp, %rsp
  popq   %rbp
  xorq   %rax, %rax
  ret
`;
  }
}
