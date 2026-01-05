import type { Doc } from './types';

export const DOCS_KEY = 'notes:documents';
export const CURRENT_KEY = 'notes:current';
export const POLL_MS = 1000;

// Persistent background color key (hex string, e.g. "#000000")
export const BG_KEY = 'notes:background';
// Disabled flag for background color (stored as '1' or '0')
export const BG_DISABLED_KEY = 'notes:background:disabled';

export function now() { return Date.now(); }

export function loadBgFromStorage(): string | null { return localStorage.getItem(BG_KEY); }
export function saveBgToStorage(bg: string) { localStorage.setItem(BG_KEY, bg); }

export function loadBgDisabledFromStorage(): boolean { return localStorage.getItem(BG_DISABLED_KEY) === '1'; }
export function saveBgDisabledToStorage(v: boolean) { localStorage.setItem(BG_DISABLED_KEY, v ? '1' : '0'); }

export function loadDocsFromStorage(): Record<string, Doc> {
	const raw = localStorage.getItem(DOCS_KEY);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, Doc>;
		return parsed || {};
	} catch (err) {
		console.warn('Failed to parse docs from storage', err);
		return {};
	}
}

export function saveDocsToStorage(docs: Record<string, Doc>) {
	localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
}


export function checkForExternalUpdates(
	docs: Record<string, Doc>,
	currentId: string | null,
	lastKnownSaveTime: number,
	handlers: { onReplace?: (remoteDoc: Doc) => void, onChange?: () => void }
): { changed: boolean, newLastKnownSaveTime?: number } {
	const remote = loadDocsFromStorage();
	let changed = false;
	for (const id of Object.keys(remote)) {
		const r = remote[id];
		if (!docs[id] || docs[id].lastSaved !== r.lastSaved) {
			docs[id] = r;
			changed = true;
		}
	}
	// Check for deletions
	for (const id of Object.keys(docs)) {
		if (!remote[id]) {
			delete docs[id];
			changed = true;
		}
	}
	if (changed && handlers.onChange) handlers.onChange();

	if (!currentId) return { changed };
	const remoteDoc = remote[currentId];
	if (!remoteDoc) return { changed };
	if (remoteDoc.lastSaved > lastKnownSaveTime) {
		if (handlers.onReplace) handlers.onReplace(remoteDoc);
		return { changed, newLastKnownSaveTime: remoteDoc.lastSaved };
	}
	return { changed };
}
