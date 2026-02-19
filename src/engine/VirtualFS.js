/**
 * VirtualFS — In-browser virtual filesystem
 *
 * Hierarchical filesystem backed by IndexedDB.
 * Files are exposed to the Blink emulator via the WASM memory interface.
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
        set('/proc/version',   'Linux 4.5 blink-1.0 x86_64 GNU/Linux\n');
        set('/proc/cpuinfo',   'model name : Blink x86-64 Virtual CPU\n');
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
        return this;
    }

    async write(path, data) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        this._mem.set(path, bytes);
        await this._dbPut(path, bytes);
    }

    async read(path) {
        if (this._mem.has(path)) return this._mem.get(path);
        const val = await this._dbGet(path);
        if (val) { this._mem.set(path, val); return val; }
        return null;
    }

    async list(dir = '/') {
        const prefix = dir.endsWith('/') ? dir : dir + '/';
        return [...this._mem.keys()]
            .filter(k => k.startsWith(prefix))
            .map(k => ({
                name:  k.slice(prefix.length).split('/')[0],
                path:  k,
                isDir: k.slice(prefix.length).includes('/'),
            }));
    }

    async delete(path) {
        this._mem.delete(path);
        await this._dbDelete(path);
    }

    _tx(mode) { return this._db.transaction(STORE, mode).objectStore(STORE); }
    _dbGet(k)    { return new Promise((r,j) => { const q=this._tx('readonly').get(k); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }
    _dbPut(k,v)  { return new Promise((r,j) => { const q=this._tx('readwrite').put(v,k); q.onsuccess=()=>r(); q.onerror=()=>j(q.error); }); }
    _dbDelete(k) { return new Promise((r,j) => { const q=this._tx('readwrite').delete(k); q.onsuccess=()=>r(); q.onerror=()=>j(q.error); }); }
}