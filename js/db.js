const DB_NAME = 'question_site_db';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function getDBItem(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // 只读事务同样可能 abort（连接被挤占等），不能让它变成永远悬挂的 Promise
        tx.onabort = () => reject(tx.error || new Error('IndexedDB readonly transaction aborted'));
    });
}

// 写入/删除必须以事务 oncomplete 为成功条件：request.onsuccess 触发时
// 事务仍可能 abort（尤其写入），那会让调用方误以为已安全落库，
// 进而在迁移里删掉 localStorage 旧副本——数据从此只存在于已中止的事务里。
export async function setDBItem(key, val) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(val, key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write transaction failed'));
        req.onerror = () => reject(req.error);
    });
}

export async function deleteDBItem(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('IndexedDB delete transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB delete transaction failed'));
        req.onerror = () => reject(req.error);
    });
}
