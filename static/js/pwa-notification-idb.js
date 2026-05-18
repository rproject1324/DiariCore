/**
 * PWA notification prefs in IndexedDB (readable by service worker; works offline).
 */
(function (global) {
    'use strict';

    const DB_NAME = 'diariCorePwaNotify';
    const DB_VERSION = 1;
    const STORE = 'prefs';
    const PREFS_KEY = 'current';

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
        });
    }

    async function writePrefs(prefs) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };
            tx.onerror = () => reject(tx.error);
            tx.objectStore(STORE).put(prefs, PREFS_KEY);
        });
    }

    async function readPrefs() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            tx.onerror = () => reject(tx.error);
            const req = tx.objectStore(STORE).get(PREFS_KEY);
            req.onsuccess = () => {
                db.close();
                resolve(req.result || null);
            };
            req.onerror = () => reject(req.error);
        });
    }

    global.DiariPwaNotificationIdb = {
        writePrefs,
        readPrefs,
        PREFS_KEY,
    };
})(typeof self !== 'undefined' ? self : window);
