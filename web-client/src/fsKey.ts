import { openDB } from 'idb';
import type { FileSystemDirectoryHandle, FileSystemFileHandle } from 'browser-fs-access';

async function db() {
    return openDB('karllm-db', 1, {
        upgrade(db) {
            db.createObjectStore('handles');
        }
    });
}

export async function getKeysDir(): Promise<FileSystemDirectoryHandle> {
    const database = await db();
    let dir = await database.get('handles', 'keysDir');
    if (!dir) {
        dir = await (window as any).showDirectoryPicker({
            id: 'karllm-keys-dir'
        });
        await database.put('handles', dir, 'keysDir');
    }
    const perm = await dir.queryPermission({ mode: 'read' });
    if (perm === 'prompt') {
        const req = await dir.requestPermission({ mode: 'read' });
        if(req !== 'granted') {
            throw new Error('Need reqd access to keys directory');
        }
    }
    return dir;
}

export async function loadJwkFromFS(filename = 'private.jwk'): Promise<JsonWebKey> {
    const dir = await getKeysDir();
    const handle: FileSystemFileHandle = await dir.getFileHandle(filename);
    const p = await handle.queryPermission({ mode: 'read' });
    if (p === 'prompt') {
        await handle.requestPermission({ mode: 'read' });
    }
    const file = await handle.getFile();
    const text = await file.text();
    return Json.parse(text) as JsonWebKey;
}
