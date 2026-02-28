import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { VirtualFS } from '../src/engine/VirtualFS.js';

const DB_NAME = 'helixcore-vfs';

function deleteDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => {};
  });
}

describe('VirtualFS persistence/listing', () => {
  let fs;

  beforeEach(async () => {
    await deleteDb(DB_NAME);
    fs = new VirtualFS();
    await fs.open();
  });

  afterEach(async () => {
    fs?._db?.close();
    fs = null;
    await deleteDb(DB_NAME);
  });

  it('lists DB-backed files after reload with a new VirtualFS instance', async () => {
    await fs.write('/home/user/reload.txt', 'hello');
    fs._db.close();

    const fsReloaded = new VirtualFS();
    await fsReloaded.open();

    const list = await fsReloaded.list('/home/user');
    expect(list.some(entry => entry.name === 'reload.txt' && entry.isDir === false)).toBe(true);

    const data = await fsReloaded.read('/home/user/reload.txt');
    expect(new TextDecoder().decode(data)).toBe('hello');

    fsReloaded._db.close();
  });

  it('returns deduplicated top-level directory entries from DB and memory', async () => {
    await fs.write('/home/user/projects/a.txt', 'a');
    await fs.write('/home/user/projects/b.txt', 'b');

    const list = await fs.list('/home/user');
    const projects = list.filter(entry => entry.name === 'projects');

    expect(projects).toHaveLength(1);
    expect(projects[0].isDir).toBe(true);
  });

  it('includes files written by another opened instance (DB merge path)', async () => {
    const fs2 = new VirtualFS();
    await fs2.open();
    await fs2.write('/home/user/shared.txt', 'from-fs2');

    const list = await fs.list('/home/user');
    expect(list.some(entry => entry.name === 'shared.txt')).toBe(true);

    fs2._db.close();
  });
});
