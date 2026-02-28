import { beforeAll, describe, it, expect, vi } from 'vitest';

vi.mock('../src/engine/AxRuntime.js', () => {
  return {
    AxRuntime: class AxRuntime {
      constructor() {
        this.onStdout = null;
        this.onStderr = null;
      }
    },
  };
});

vi.mock('../src/engine/Compiler.js', () => {
  return {
    Compiler: class Compiler {},
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

function makeEditorStub(initialFiles, active = Object.keys(initialFiles)[0]) {
  const files = { ...initialFiles };
  let current = active;

  return {
    hasFile(name) {
      return Object.prototype.hasOwnProperty.call(files, name);
    },
    addFile(name, content = '') {
      files[name] = content;
      current = name;
    },
    renameFile(oldName, newName) {
      const content = files[oldName] ?? '';
      delete files[oldName];
      files[newName] = content;
      if (current === oldName) current = newName;
    },
    deleteFile(name) {
      delete files[name];
      if (current === name) current = Object.keys(files)[0] ?? null;
    },
    listFiles() {
      return Object.keys(files).sort((a, b) => a.localeCompare(b));
    },
    getFile() {
      return current;
    },
    getFileContent(name) {
      return files[name] ?? '';
    },
    _snapshot() {
      return { ...files, __active: current };
    },
  };
}

function makeSidebarStub(active = null) {
  const state = { active };
  return {
    setFiles: vi.fn((names, selected) => {
      state.active = selected ?? state.active ?? names[0] ?? null;
    }),
    selectFile: vi.fn((name) => {
      state.active = name;
    }),
    getActiveFile: vi.fn(() => state.active),
    _state: state,
  };
}

function makeApp(initialFiles, active) {
  const app = new App({});
  app.editor = makeEditorStub(initialFiles, active);
  app.sidebar = makeSidebarStub(active);
  app.vfs = {
    write: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  app.terminal = {
    error: vi.fn(),
  };
  return app;
}

describe('App file lifecycle handlers', () => {
  it('creates a file and persists it to VFS', async () => {
    const app = makeApp({ 'main.c': 'int main(){return 0;}' }, 'main.c');

    await app._createFile('notes.txt');

    expect(app.editor.hasFile('notes.txt')).toBe(true);
    expect(app.vfs.write).toHaveBeenCalledWith('/home/user/notes.txt', '');
    expect(app.sidebar.setFiles).toHaveBeenCalled();
    expect(app.sidebar.selectFile).toHaveBeenCalledWith('notes.txt', true);
  });

  it('renames a file and updates VFS paths', async () => {
    const app = makeApp({ 'main.c': 'int x=1;' }, 'main.c');

    await app._renameFile('main.c', 'app.c');

    expect(app.editor.hasFile('main.c')).toBe(false);
    expect(app.editor.hasFile('app.c')).toBe(true);
    expect(app.vfs.write).toHaveBeenCalledWith('/home/user/app.c', 'int x=1;');
    expect(app.vfs.delete).toHaveBeenCalledWith('/home/user/main.c');
    expect(app.sidebar.selectFile).toHaveBeenCalledWith('app.c', true);
  });

  it('deletes active file, persists delete, and selects next file', async () => {
    const app = makeApp({ 'a.c': 'a', 'b.c': 'b' }, 'a.c');

    await app._deleteFile('a.c');

    expect(app.editor.hasFile('a.c')).toBe(false);
    expect(app.vfs.delete).toHaveBeenCalledWith('/home/user/a.c');
    expect(app.sidebar.selectFile).toHaveBeenCalledWith('b.c', true);
  });

  it('does not delete the last remaining file', async () => {
    const app = makeApp({ 'main.c': 'only' }, 'main.c');

    await app._deleteFile('main.c');

    expect(app.editor.hasFile('main.c')).toBe(true);
    expect(app.vfs.delete).not.toHaveBeenCalled();
    expect(app.terminal.error).toHaveBeenCalledWith('[Error] Cannot delete the last file');
  });

  it('rejects invalid file names on create', async () => {
    const app = makeApp({ 'main.c': 'only' }, 'main.c');

    await app._createFile('bad/name.c');
    await app._createFile('bad\\name.c');
    await app._createFile('   ');

    expect(app.editor.hasFile('bad/name.c')).toBe(false);
    expect(app.editor.hasFile('bad\\name.c')).toBe(false);
    expect(app.vfs.write).not.toHaveBeenCalled();
    expect(app.terminal.error).toHaveBeenCalledTimes(3);
    expect(app.terminal.error).toHaveBeenNthCalledWith(1, '[Error] Invalid file name');
    expect(app.terminal.error).toHaveBeenNthCalledWith(2, '[Error] Invalid file name');
    expect(app.terminal.error).toHaveBeenNthCalledWith(3, '[Error] Invalid file name');
  });
});
