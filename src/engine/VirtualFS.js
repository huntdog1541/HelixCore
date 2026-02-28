/**
 * VirtualFS — In-browser virtual filesystem
 *
 * Hierarchical filesystem backed by IndexedDB.
 * Files are exposed to the emulator via the WASM memory interface.
 *
 * Default structure:
 *   /home/user/   ← user workspace
 *   /bin/         ← emulated binaries (ELFs)
 *   /tmp/         ← temporary files
 *   /proc/        ← emulated procfs (read-only stubs)
 *   /etc/         ← config stubs
 */

const DB_NAME    = 'helixcore-vfs';
const DB_VERSION = 1;
const STORE      = 'files';

export class VirtualFS {
    constructor() {
        this._db  = null;
        this._mem = new Map();
        this._seedDefaults();
    }

    _seedDefaults() {
        const set = (k, v) => this._mem.set(k, new TextEncoder().encode(v));
        set('/proc/version',   'Linux 4.5 ax-0.6 x86_64 GNU/Linux\n');
        set('/proc/cpuinfo',   'model name : x86-64 Virtual CPU\n');
        set('/etc/hostname',   'helixcore\n');
        set('/etc/os-release', 'NAME="HelixCore OS"\nVERSION="0.1"\n');
    }

    async open() {
        this._db = await new Promise((res, rej) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
            req.onsuccess = e => res(e.target.result);
            req.onerror   = () => rej(req.error);
        });
        await this._hydrateFromDb();
        return this;
    }

    async write(path, data) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        this._mem.set(path, bytes);
        await this._dbPut(path, bytes);
    }

    writeSync(path, data) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        this._mem.set(path, bytes);
        this._queuePut(path, bytes);
        return bytes;
    }

    async writeAt(path, data, offset = 0) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const base = await this.read(path) ?? new Uint8Array(0);
        const start = Math.max(0, Number(offset) || 0);
        const outLen = Math.max(base.length, start + bytes.length);
        const out = new Uint8Array(outLen);
        out.set(base);
        out.set(bytes, start);
        this._mem.set(path, out);
        await this._dbPut(path, out);
        return bytes.length;
    }

    writeAtSync(path, data, offset = 0) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const base = this.readSync(path) ?? new Uint8Array(0);
        const start = Math.max(0, Number(offset) || 0);
        const outLen = Math.max(base.length, start + bytes.length);
        const out = new Uint8Array(outLen);
        out.set(base);
        out.set(bytes, start);
        this._mem.set(path, out);
        this._queuePut(path, out);
        return bytes.length;
    }

    async truncate(path, size = 0) {
        const current = await this.read(path) ?? new Uint8Array(0);
        const nextSize = Math.max(0, Number(size) || 0);
        const out = new Uint8Array(nextSize);
        out.set(current.slice(0, nextSize));
        this._mem.set(path, out);
        await this._dbPut(path, out);
    }

    truncateSync(path, size = 0) {
        const current = this.readSync(path) ?? new Uint8Array(0);
        const nextSize = Math.max(0, Number(size) || 0);
        const out = new Uint8Array(nextSize);
        out.set(current.slice(0, nextSize));
        this._mem.set(path, out);
        this._queuePut(path, out);
    }

    async read(path) {
        if (this._mem.has(path)) return this._mem.get(path);
        const val = await this._dbGet(path);
        if (val) { this._mem.set(path, val); return val; }
        return null;
    }

    readSync(path) {
        if (this._mem.has(path)) return this._mem.get(path);
        return null;
    }

    async exists(path) {
        return (await this.read(path)) !== null;
    }

    async getSize(path) {
        const data = await this.read(path);
        return data ? data.length : -1;
    }

    getSizeSync(path) {
        const data = this.readSync(path);
        return data ? data.length : -1;
    }

    async list(dir = '/') {
        const prefix = dir.endsWith('/') ? dir : dir + '/';
        const keys = new Set(this._mem.keys());

        if (this._db) {
            const dbKeys = await this._dbKeys();
            dbKeys.forEach(k => keys.add(k));
        }

        const rows = new Map();
        for (const key of keys) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            if (!rest) continue;
            const name = rest.split('/')[0];
            const isDir = rest.includes('/');
            const path = isDir ? `${prefix}${name}` : key;
            const prev = rows.get(name);
            rows.set(name, {
                name,
                path,
                isDir: Boolean(isDir || prev?.isDir),
            });
        }

        return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    async delete(path) {
        this._mem.delete(path);
        await this._dbDelete(path);
    }

    deleteSync(path) {
        this._mem.delete(path);
        this._queueDelete(path);
    }

    async _hydrateFromDb() {
        const keys = await this._dbKeys();
        for (const key of keys) {
            if (this._mem.has(key)) continue;
            const val = await this._dbGet(key);
            if (val) this._mem.set(key, val);
        }
    }

    _dbKeys() {
        return new Promise((resolve, reject) => {
            const store = this._tx('readonly');
            if (typeof store.getAllKeys === 'function') {
                const req = store.getAllKeys();
                req.onsuccess = () => resolve(req.result ?? []);
                req.onerror = () => reject(req.error);
                return;
            }

            const out = [];
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) {
                    resolve(out);
                    return;
                }
                out.push(cursor.key);
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });
    }

    _tx(mode) { return this._db.transaction(STORE, mode).objectStore(STORE); }
    _queuePut(k, v) {
        if (!this._db) return;
        this._dbPut(k, v).catch(() => {});
    }
    _queueDelete(k) {
        if (!this._db) return;
        this._dbDelete(k).catch(() => {});
    }
    _dbGet(k)    { return new Promise((r,j) => { const q=this._tx('readonly').get(k); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }
    _dbPut(k,v)  { return new Promise((r,j) => { const q=this._tx('readwrite').put(v,k); q.onsuccess=()=>r(); q.onerror=()=>j(q.error); }); }
    _dbDelete(k) { return new Promise((r,j) => { const q=this._tx('readwrite').delete(k); q.onsuccess=()=>r(); q.onerror=()=>j(q.error); }); }
}