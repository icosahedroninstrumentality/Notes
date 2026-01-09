import type { Doc } from './types';

export const DOCS_KEY = 'notes:documents';
export const CURRENT_KEY = 'notes:current';
export const POLL_MS = 1000;
export const IMAGES_KEY = 'notes:images';
export const IMAGE_KEY_PREFIX = 'notes:image:';

// Persistent background color key (hex string, e.g. "#000000")
export const BG_KEY = 'notes:background';
// Disabled flag for background color (stored as '1' or '0')
export const BG_DISABLED_KEY = 'notes:background:disabled';

export function now() { return Date.now(); }

export function loadBgFromStorage(): string | null { return localStorage.getItem(BG_KEY); }
export function saveBgToStorage(bg: string) { localStorage.setItem(BG_KEY, bg); }

export function loadBgDisabledFromStorage(): boolean { return localStorage.getItem(BG_DISABLED_KEY) === '1'; }
export function saveBgDisabledToStorage(v: boolean) { localStorage.setItem(BG_DISABLED_KEY, v ? '1' : '0'); }

// Images storage helpers - store images as data URLs in a map saved to localStorage
export function loadImagesFromStorage(): Record<string, string> {
	// Return a map constructed from per-image keys (backwards compatible with old IMAGES_KEY map)
	const out: Record<string, string> = {};
	try {
		// first, try per-image keys
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (key.startsWith(IMAGE_KEY_PREFIX)) {
				const id = key.slice(IMAGE_KEY_PREFIX.length);
				const val = localStorage.getItem(key);
				if (val) out[id] = val;
			}
		}
		// fallback for legacy map stored under IMAGES_KEY
		if (!Object.keys(out).length) {
			const raw = localStorage.getItem(IMAGES_KEY);
			if (!raw) return out;
			try {
				const parsed = JSON.parse(raw) as Record<string, string> || {};
				return parsed;
			} catch (e) {
				// ignore and return whatever we collected
			}
		}
		return out;
	} catch (e) {
		console.warn('Failed to load images from storage', e);
		return out;
	}
}

export function saveImagesToStorage(images: Record<string, string>) {
	// Backwards-compat: write entire map under IMAGES_KEY for older consumers (migration will convert)
	try { localStorage.setItem(IMAGES_KEY, JSON.stringify(images)); } catch (e) { console.warn('Failed to save images to storage', e); }
}

export function saveImageToStorage(id: string, dataUrl: string) {
	try { localStorage.setItem(IMAGE_KEY_PREFIX + id, dataUrl); } catch (e) { console.warn('Failed to save image', e); }
}

export function getImageFromStorage(id: string): string | undefined {
	try { return localStorage.getItem(IMAGE_KEY_PREFIX + id) || undefined; } catch (e) { console.warn('Failed to get image', e); return undefined; }
}

export function removeImageFromStorage(id: string) {
	try { localStorage.removeItem(IMAGE_KEY_PREFIX + id); } catch (e) { console.warn('Failed to remove image', e); }
}

// Per-doc content storage (store content separately so we can lazy-load/unload)
export const DOC_DATA_PREFIX = 'notes:doc:';

export function saveDocContent(id: string, content: string) {
	try { localStorage.setItem(DOC_DATA_PREFIX + id, content); } catch (e) { console.warn('Failed to save doc content', e); }
}

export function loadDocContent(id: string): string | null {
	try { return localStorage.getItem(DOC_DATA_PREFIX + id); } catch (e) { console.warn('Failed to load doc content', e); return null; }
}

export function removeDocContent(id: string) {
	try { localStorage.removeItem(DOC_DATA_PREFIX + id); } catch (e) { console.warn('Failed to remove doc content', e); }
}



export function loadDocsFromStorage(): Record<string, Doc> {
	const raw = localStorage.getItem(DOCS_KEY);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, Doc> || {};
		// Run migrations in order: images (v2), then split docs (v3)
		try {
			const ver = getStorageVersion();
			if (ver < 2) {
				const changed = migrateDocsImages(parsed);
				if (changed) saveDocsToStorage(parsed);
		}
		if (ver < 3) {
			const changed2 = migrateSplitDocs(parsed);
			if (changed2) saveDocsToStorage(parsed);
		}
		// v4: migrate legacy images map into per-image keys
		if (ver < 4) {
			const changed3 = migrateImagesMapToPerKey();
			if (changed3) {
				// nothing to update in docs metadata for this migration
			}
		}
		if (ver < CURRENT_STORAGE_VERSION) setStorageVersion(CURRENT_STORAGE_VERSION);
		} catch (e) {
			console.warn('Migration failed', e);
		}
		return parsed;
	} catch (err) {
		console.warn('Failed to parse docs from storage', err);
		return {};
	}
}

export function saveDocsToStorage(docs: Record<string, Doc>) {
	localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
}

// Storage schema versioning
export const STORAGE_VERSION_KEY = 'notes:storage:version';
export const CURRENT_STORAGE_VERSION = 4;

export function getStorageVersion(): number {
	const v = localStorage.getItem(STORAGE_VERSION_KEY);
	if (!v) return 0;
	const n = parseInt(v, 10);
	return isNaN(n) ? 0 : n;
}
export function setStorageVersion(v: number) { localStorage.setItem(STORAGE_VERSION_KEY, String(v)); }

// Migrate embedded data-URL images from document HTML into the images store
export function migrateDocsImages(docs: Record<string, Doc>): boolean {
	const images = loadImagesFromStorage();
	let changed = false;
	for (const id of Object.keys(docs)) {
		const doc = docs[id];
		if (!doc || !doc.content) continue;
		const re = /<img[^>]+src=(?:\"|\')(data:[^\"\']+)(?:\"|\')[^>]*>/gi;
		let m: RegExpExecArray | null;
		let newContent = doc.content;
		while ((m = re.exec(doc.content)) !== null) {
			const dataUrl = m[1];
			// find existing id for this data URL
			let existingId = Object.keys(images).find(k => images[k] === dataUrl);
			if (!existingId) {
				existingId = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
				images[existingId] = dataUrl;
			}
			// replace occurrences of the data URL with placeholder
			newContent = newContent.split(dataUrl).join(`notes:image:${existingId}`);
			changed = true;
		}
		if (changed && newContent !== doc.content) {
			doc.content = newContent;
			doc.lastSaved = now();
		}
	}
	if (changed) saveImagesToStorage(images);
	return changed;
}

// Migrate document content into per-doc storage keys (notes:doc:{id}) and clear inline content from docs metadata
export function migrateSplitDocs(docs: Record<string, Doc>): boolean {
	let changed = false;
	for (const id of Object.keys(docs)) {
		const doc = docs[id];
		if (!doc) continue;
		if (doc.content && doc.content.trim()) {
			saveDocContent(id, doc.content);
			doc.content = '';
			doc.lastSaved = now();
			changed = true;
		}
	}
	return changed;
}

// Migrate legacy images map stored under IMAGES_KEY into per-image keys
export function migrateImagesMapToPerKey(): boolean {
	const raw = localStorage.getItem(IMAGES_KEY);
	if (!raw) return false;
	try {
		const parsed = JSON.parse(raw) as Record<string, string> || {};
		let changed = false;
		for (const id of Object.keys(parsed)) {
			const data = parsed[id];
			if (!data) continue;
			// if a per-key entry already exists, skip
			if (!localStorage.getItem(IMAGE_KEY_PREFIX + id)) {
				localStorage.setItem(IMAGE_KEY_PREFIX + id, data);
				changed = true;
			}
		}
		// remove legacy map once migrated
		try { localStorage.removeItem(IMAGES_KEY); } catch (e) {}
		return changed;
	} catch (e) {
		console.warn('Failed to migrate images map', e);
		return false;
	}
}

// Find all image ids referenced in docs metadata and per-doc content
export function findReferencedImageIds(docs: Record<string, Doc>): Set<string> {
	const ids = new Set<string>();
	const re = /notes:image:([A-Za-z0-9\-_]+)/g;
	for (const id of Object.keys(docs)) {
		const doc = docs[id];
		if (!doc) continue;
		if (doc.content) {
			let m: RegExpExecArray | null;
			while ((m = re.exec(doc.content)) !== null) ids.add(m[1]);
		}
	}
	// scan per-doc content keys
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (!key.startsWith(DOC_DATA_PREFIX)) continue;
			const val = localStorage.getItem(key);
			if (!val) continue;
			let m: RegExpExecArray | null;
			while ((m = re.exec(val)) !== null) ids.add(m[1]);
		}
	} catch (e) {
		console.warn('Failed to scan per-doc content for image references', e);
	}
	return ids;
}

// Remove any per-image entries that are not referenced by any document
export function removeUnreferencedImages(docs: Record<string, Doc>): boolean {
	const referenced = findReferencedImageIds(docs);
	let removed = false;
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (!key.startsWith(IMAGE_KEY_PREFIX)) continue;
			const id = key.slice(IMAGE_KEY_PREFIX.length);
			if (!referenced.has(id)) {
				localStorage.removeItem(key);
				removed = true;
			}
		}
	} catch (e) {
		console.warn('Failed to remove unreferenced images', e);
	}
	return removed;
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
