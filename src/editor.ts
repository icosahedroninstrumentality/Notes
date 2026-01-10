
export function ensureCaretVisible(padded: HTMLElement) {
	const sel = window.getSelection();
	if (!sel || !sel.rangeCount) return;
	// Use the real selection range for insertion fallback if needed, but
	// use a cloned, collapsed range to measure first to avoid mutating it.
	const realRange = sel.getRangeAt(0);
	const measureRange = realRange.cloneRange();
	measureRange.collapse(false);
	let rect = measureRange.getBoundingClientRect();
	// If rect is empty (some browsers), try the caret's container, and
	// as a last resort insert a tiny temporary marker at the caret and
	// measure that. This avoids falling back to padded.lastElementChild
	// which can jump the view to the bottom.
	if (!rect || (rect.top === 0 && rect.bottom === 0)) {
		// prefer nearest element containing the caret
		const start = realRange.startContainer;
		let el: HTMLElement | null = null;
		if (start.nodeType === Node.ELEMENT_NODE) el = start as HTMLElement;
		else if ((start as Node).parentElement) el = (start as Node).parentElement;
		if (el && padded.contains(el)) {
			rect = el.getBoundingClientRect();
		} else {
			// insert a temporary zero-size marker at the caret and measure it
			const marker = document.createElement('span');
			marker.style.cssText = 'display:inline-block;width:0px;height:0px;overflow:hidden;';
			marker.setAttribute('aria-hidden', 'true');
			// insert marker using the real range
			const insertRange = realRange.cloneRange();
			insertRange.collapse(false);
			insertRange.insertNode(marker);
			rect = marker.getBoundingClientRect();
			// clean up marker
			marker.parentNode?.removeChild(marker);
			// restore selection (removeAllRanges/addRange preserves caret)
			sel.removeAllRanges();
			sel.addRange(realRange);
		}
		if (!rect || (rect.top === 0 && rect.bottom === 0)) return;
	}
	const paddedRect = padded.getBoundingClientRect();
	const offset = 12;
	if (rect.bottom > paddedRect.bottom - offset) {
		padded.scrollTop += rect.bottom - paddedRect.bottom + offset;
	} else if (rect.top < paddedRect.top + offset) {
		padded.scrollTop += rect.top - paddedRect.top - offset;
	}
}

// Utility: convert rgb() or rgba() string to hex if possible
function rgbStringToHex(s: string): string | null {
	if (!s) return null;
	// already hex
	if (s.startsWith('#')) return s;
	const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
	if (!m) return null;
	const r = parseInt(m[1], 10);
	const g = parseInt(m[2], 10);
	const b = parseInt(m[3], 10);
	return "#" + [r,g,b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Update toolbar button active states and sync color picker
export function updateToolbarState(toolbar: Element | null) {
	if (!toolbar) return;
	for (const el of Array.from(toolbar.querySelectorAll('.toolbar-btn'))) {
		const btn = el as HTMLButtonElement;
		const cmd = btn.dataset.cmd!;
		let active = false;
		try {
			if (cmd === 'formatBlock') {
				const val = document.queryCommandValue('formatBlock') || '';
				active = val.toLowerCase().includes((btn.dataset.value || '').replace(/[<>]/g, '').toLowerCase());
			} else {
				active = document.queryCommandState(cmd);
			}
		} catch (e) {
			active = false;
		}
		if (active) btn.classList.add('active'); else btn.classList.remove('active');
	}

	// sync text color picker value with the current selection (if available)
	try {
		const colorInput = toolbar.querySelector('#text-color-picker') as HTMLInputElement | null;
		if (colorInput) {
			const val = document.queryCommandValue('foreColor') || document.queryCommandValue('color') || '';
			const hex = rgbStringToHex(val) || (val && val.startsWith('#') ? val : '');
			if (hex) colorInput.value = hex as string;
		}
	} catch (e) {
		// ignore
	}
}

// Apply text color to current selection
export function setTextColor(color: string) {
	document.execCommand('foreColor', false, color);
}

// Saved colors persistence & UI
const SAVED_COLORS_KEY = 'savedTextColors';
function loadSavedColors(): string[] {
	try {
		const raw = localStorage.getItem(SAVED_COLORS_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as string[];
	} catch (e) {
		return [];
	}
}
function saveSavedColors(cols: string[]) {
	try { localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(cols)); } catch (e) { /* ignore */ }
}

function renderSavedColors(toolbar: Element | null) {
	if (!toolbar) return;
	const container = toolbar.querySelector('#saved-colors') as HTMLElement | null;
	if (!container) return;
	container.innerHTML = '';
	const cols = loadSavedColors();
	const currentColor = (() => {
		try { return document.queryCommandValue('foreColor') || document.queryCommandValue('color') || ''; } catch (e) { return ''; }
	})();
	for (const c of cols) {
		const btn = document.createElement('button');
		btn.className = 'color-swatch';
		btn.setAttribute('type', 'button');
		btn.dataset.color = c;
		btn.style.background = c;
		btn.title = c;
		if (c.toLowerCase() === (currentColor || '').toLowerCase() || c.toLowerCase() === rgbStringToHex(currentColor || '')?.toLowerCase()) {
			btn.classList.add('active');
		}
		// click applies color
		btn.addEventListener('click', () => {
			setTextColor(c);
			updateToolbarState(toolbar);
		});
		// right-click shows remove context menu
		btn.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			showContextMenu(e.pageX, e.pageY, c);
		});
		// double-click removes color (legacy behavior)
		btn.addEventListener('dblclick', () => {
			if (!confirm(`Remove color ${c}?`)) return;
			const remaining = loadSavedColors().filter(x => x !== c);
			saveSavedColors(remaining);
			renderSavedColors(toolbar);
		});
		container.appendChild(btn);
	}
}

// Context menu for color swatches
let contextMenuEl: HTMLElement | null = null;
let onRemoveSavedColor: ((color: string) => void) | null = null;

function ensureContextMenu() {
	if (contextMenuEl) return;
	contextMenuEl = document.createElement('div');
	contextMenuEl.className = 'swatch-context-menu';
	contextMenuEl.style.display = 'none';
	contextMenuEl.innerHTML = '<button type="button" class="ctx-remove">Remove color</button>';
	document.body.appendChild(contextMenuEl);

	// click handler inside menu
	contextMenuEl.addEventListener('click', (e) => {
		const btn = e.target as HTMLElement;
		if (btn.classList.contains('ctx-remove')) {
			const color = contextMenuEl!.dataset.color;
			if (color && onRemoveSavedColor) onRemoveSavedColor(color);
			hideContextMenu();
		}
	});

	// hide on outside click or escape
	document.addEventListener('click', (e) => { if (contextMenuEl && (e.target as Element).closest('.swatch-context-menu') == null) hideContextMenu(); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
	window.addEventListener('resize', hideContextMenu);
	window.addEventListener('scroll', hideContextMenu, true);
}

function showContextMenu(x: number, y: number, color: string) {
	ensureContextMenu();
	if (!contextMenuEl) return;
	contextMenuEl.style.display = 'block';
	contextMenuEl.dataset.color = color;
	// position and clamp to viewport
	const rect = contextMenuEl.getBoundingClientRect();
	const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
	const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
	let left = x;
	let top = y;
	if (left + rect.width > vw) left = Math.max(8, vw - rect.width - 8);
	if (top + rect.height > vh) top = Math.max(8, vh - rect.height - 8);
	contextMenuEl.style.left = left + 'px';
	contextMenuEl.style.top = top + 'px';
}

function hideContextMenu() {
	if (!contextMenuEl) return;
	contextMenuEl.style.display = 'none';
	delete contextMenuEl.dataset.color;
}


// Create the toolbar and wire up handlers. We accept callbacks to avoid tight coupling with app state.
export function createToolbar(
	padded: HTMLElement,
	handlers: {
		saveCurrentDoc: (opts?: { forceTimestamp?: boolean }) => void,
		setModified: (v: boolean) => void,
		enforceFont: (p: HTMLElement, font: string) => void,
		getCurrentDocumentFont: () => string,
		setCurrentDocumentFont: (font: string) => void
	}
) {
	const toolbar = document.querySelector('.editor-toolbar') as HTMLElement | null;
	if (!toolbar) return null;

	// Attach click handlers for existing buttons
	for (const el of Array.from(toolbar.querySelectorAll('.toolbar-btn'))) {
		const btn = el as HTMLButtonElement;
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			padded.focus();
			const cmd = btn.dataset.cmd || '';
			const val = btn.dataset.value;
			if (cmd === 'clear') {
				// call into app to clear formatting
				const clearFn = (window as any).clearAllFormatting;
				if (typeof clearFn === 'function') clearFn(padded);
			} else if (val) {
				document.execCommand(cmd, false, val);
			} else if (cmd) {
				document.execCommand(cmd, false);
			}
			handlers.setModified(true);
			updateToolbarState(toolbar);
		});
	}

	// Wire up font selector
	const fontSel = document.getElementById('font-selector') as HTMLSelectElement | null;
	if (fontSel) {
		fontSel.value = handlers.getCurrentDocumentFont() || 'Arial, Helvetica, sans-serif';
		fontSel.addEventListener('change', () => {
			if (!padded) return;
			const font = fontSel.value;
			handlers.enforceFont(padded, font);
			// persist the selected font immediately
			if (handlers.setCurrentDocumentFont) {
				handlers.setCurrentDocumentFont(font);
			} else {
				handlers.setModified(true);
				handlers.saveCurrentDoc();
			}
		});
	}

	// Text color picker
	const textColor = document.getElementById('text-color-picker') as HTMLInputElement | null;
	if (textColor) {
		// apply color as the user selects it
		textColor.addEventListener('input', () => {
			padded.focus();
			document.execCommand('foreColor', false, textColor.value);
			handlers.setModified(true);
			updateToolbarState(toolbar);
			// highlight saved swatch if present
			renderSavedColors(toolbar);
		});
		// apply color on commit (useful for keyboard/assistive tools)
		textColor.addEventListener('change', () => {
			padded.focus();
			document.execCommand('foreColor', false, textColor.value);
			handlers.setModified(true);
			handlers.saveCurrentDoc();
			renderSavedColors(toolbar);
		});
	}

	// Save color button
	const saveBtn = document.getElementById('save-color') as HTMLButtonElement | null;
	if (saveBtn) {
		saveBtn.addEventListener('click', () => {
			const color = (document.getElementById('text-color-picker') as HTMLInputElement | null)?.value;
			if (!color) return;
			const cols = loadSavedColors();
			if (!cols.includes(color)) {
				cols.unshift(color);
				// keep a small list
				if (cols.length > 12) cols.length = 12;
				saveSavedColors(cols);
				renderSavedColors(toolbar);
				handlers.saveCurrentDoc();
			}
		});
	}

	// render saved colors initially
	renderSavedColors(toolbar);

	// hook up remove callback for context menu
	onRemoveSavedColor = (color: string) => {
		if (!confirm(`Remove color ${color}?`)) return;
		const remaining = loadSavedColors().filter(x => x !== color);
		saveSavedColors(remaining);
		renderSavedColors(toolbar);
		handlers.saveCurrentDoc();
		hideContextMenu();
	};

	// update active state when selection changes
	document.addEventListener('selectionchange', () => updateToolbarState(toolbar));
	return toolbar;
}

import type { Doc } from './types';
import { loadDocsFromStorage, checkForExternalUpdates, DOCS_KEY, CURRENT_KEY, POLL_MS, saveImageToStorage } from './store';
import { convertMarkdownToHtml } from './utils/markdown';

export function setupEditor(options: {
	padded: HTMLElement,
	getDocs: () => Record<string, Doc>,
	setDocs: (d: Record<string, Doc>) => void,
	getCurrentId: () => string,
	setCurrentId: (id: string) => void,
	getLastKnownSaveTime: () => number,
	setLastKnownSaveTime: (t: number) => void,
	saveCurrentDoc: (opts?: { forceTimestamp?: boolean }) => void,
	setModified: (v: boolean) => void,
	updateToolbarState: (toolbar: Element | null) => void,
	sanitizeHTML: (html: string) => string,
	escapeHtml: (s: string) => string,
	createNewDoc: (title?: string) => void,
	selectDoc: (id: string) => void,
	renderSidebar: () => void,
	updateHeader: (doc: Doc) => void
}) {
	const padded = options.padded;
	padded.setAttribute('contenteditable', 'true');
	let saveTimer: number | null = null;
	padded.addEventListener('input', () => {
		// debounce frequent input events and autosave
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = window.setTimeout(() => {
			saveTimer = null;
			options.saveCurrentDoc({forceTimestamp:true});
		}, 250);
	});

	// capture common formatting shortcuts and update toolbar state
	padded.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Tab') {
			e.preventDefault();
			const sel = window.getSelection();
			if (!sel || !sel.rangeCount) return;
			const range = sel.getRangeAt(0);
			const node = document.createTextNode('	');
			range.insertNode(node);
			range.setStartAfter(node);
			range.setEndAfter(node);
			sel.removeAllRanges();
			sel.addRange(range);
			options.setModified(true);
			return;
		}

		// keyboard shortcuts: accept ctrl, meta (⌘) or alt as modifier
		const mod = e.ctrlKey || e.metaKey || e.altKey;
		if (mod && !e.shiftKey) {
			const k = e.key;
			if (k.toLowerCase() === 'b' || k.toLowerCase() === 'i' || k.toLowerCase() === 'u') {
				e.preventDefault();
				const cmd = k.toLowerCase() === 'b' ? 'bold' : k.toLowerCase() === 'i' ? 'italic' : 'underline';
				document.execCommand(cmd, false);
				options.setModified(true);
				options.updateToolbarState(document.querySelector('.editor-toolbar'));
				return;
			}
			// superscript (modifier + ',')
			if (k === ',') {
				e.preventDefault();
				document.execCommand('superscript', false);
				options.setModified(true);
				options.updateToolbarState(document.querySelector('.editor-toolbar'));
				return;
			}
			// subscript (modifier + '.')
			if (k === '.') {
				e.preventDefault();
				document.execCommand('subscript', false);
				options.setModified(true);
				options.updateToolbarState(document.querySelector('.editor-toolbar'));
				return;
			}
		}

		if ((e.ctrlKey || e.metaKey || e.altKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
			e.preventDefault();
			document.execCommand('strikeThrough', false);
			options.setModified(true);
			options.updateToolbarState(document.querySelector('.editor-toolbar'));
			return;
		}

		if (e.key === 'Enter') {
			// allow default insertion but ensure the editor container scrolls to keep caret visible
			window.setTimeout(() => {
				options.updateToolbarState(document.querySelector('.editor-toolbar'));
				ensureCaretVisible(padded);
			}, 0);
		}

		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			options.saveCurrentDoc({ forceTimestamp: true });
		}
	});

	// sanitize pasted content, support markdown, and handle pasted images
	padded.addEventListener('paste', (e: ClipboardEvent) => {
		e.preventDefault();
		const cb = (e.clipboardData ?? (window as any).clipboardData) as DataTransfer | null;
		if (!cb) return;

		// First, handle image files from clipboard (e.g., screenshots)
		const items = cb.items ? Array.from(cb.items) as DataTransferItem[] : [];
		const imageItems = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
		if (imageItems.length) {
			const promises = imageItems.map(it => {
				const file = it.getAsFile();
				if (!file) return Promise.resolve(null);
				return new Promise<{id: string, data: string} | null>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => {
						const dataUrl = String(reader.result || '');
						const id = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
						saveImageToStorage(id, dataUrl);
						resolve({ id, data: dataUrl });
					};
					reader.onerror = () => resolve(null);
					reader.readAsDataURL(file);
				});
			});

			Promise.all(promises).then(results => {
				for (const r of results) {
					if (!r) continue;
					// insert placeholder and then update the inserted node to display the data URL
					try {
						document.execCommand('insertHTML', false, `<img src=\"notes:image:${r.id}\" alt=\"image\">`);
						// find the inserted placeholder image and attach data attributes
						const imgs = padded.querySelectorAll(`img[src=\"notes:image:${r.id}\"]`);
						if (imgs.length) {
							const img = imgs[imgs.length - 1] as HTMLImageElement;
							img.setAttribute('data-image-id', r.id);
							img.src = r.data; // use data URL for display
						}
					} catch (err) {
						document.execCommand('insertText', false, '[image]');
					}
					options.setModified(true);
				}
				window.setTimeout(() => options.saveCurrentDoc({forceTimestamp:true}), 0);

			});
			return;
		}

		// fallback: try HTML, otherwise text which may be markdown
		const html = cb.getData('text/html');
		const text = cb.getData('text/plain');
		let content = '';
		if (html) {
			content = options.sanitizeHTML(html);
			// if sanitization removed everything, fallback to plain text
			if (!content && text) {
				const parts = text.replace(/\r\n/g, '\n').split('\n');
				content = parts.map(p => `<p>${options.escapeHtml(p)}</p>`).join('');
			}
		} else if (text) {
			// detect markdown-like content and convert to HTML when applicable
			const looksLikeMarkdown = /(^#{1,6}\s)|(^[-*]\s+)|(^\d+\.\s+)|`|\*\*|__|\[.+\]\(.+\)|!\[.+\]\(.+\)|^```/m;
			if (looksLikeMarkdown.test(text)) {
				content = convertMarkdownToHtml(text);
				content = options.sanitizeHTML(content);
			} else {
				const parts = text.replace(/\r\n/g, '\n').split('\n');
				content = parts.map(p => `<p>${options.escapeHtml(p)}</p>`).join('');
			}
		}

		if (content) {
			try {
				document.execCommand('insertHTML', false, content);
			} catch (err) {
				document.execCommand('insertText', false, text);
			}
			// enforce document font across pasted content
			options.setModified(true);
			// ensure save happens promptly
			window.setTimeout(() => options.saveCurrentDoc({forceTimestamp:true}), 0);
			// ensure caret visibility
			window.setTimeout(() => ensureCaretVisible(padded), 0);
		} else if (text) {
			document.execCommand('insertText', false, text);
			options.setModified(true);
			window.setTimeout(() => options.saveCurrentDoc({forceTimestamp:true}), 0);
		}
	});

	// load and migrate
	const docs = loadDocsFromStorage();
	options.setDocs(docs);
	// ensure at least one doc exists
	if (!Object.keys(docs).length) options.createNewDoc('Welcome');
	// pick last-opened or first
	const lastOpen = localStorage.getItem(CURRENT_KEY);
	const pick = lastOpen && docs[lastOpen] ? lastOpen : Object.keys(docs)[0];
	options.selectDoc(pick);
	options.renderSidebar();

	// poll for external changes
	const pollId = window.setInterval(() => {
		checkForExternalUpdates(docs, options.getCurrentId(), options.getLastKnownSaveTime(), {
			onReplace: (remoteDoc: Doc) => {
				const paddedEl = options.padded;
				if (!paddedEl) return;
				paddedEl.innerHTML = remoteDoc.content;
				if (options.getCurrentId()) docs[options.getCurrentId()!] = remoteDoc;
				options.setLastKnownSaveTime(remoteDoc.lastSaved);
				options.setModified(false);
				options.renderSidebar();
			},
			onChange: () => options.renderSidebar()
		});
	}, POLL_MS);

	// clear on unload
	window.addEventListener('beforeunload', () => {
		clearInterval(pollId);
	});

	// react to storage events too
	window.addEventListener('storage', (e) => {
		if (e.key === DOCS_KEY) {
			checkForExternalUpdates(docs, options.getCurrentId(), options.getLastKnownSaveTime(), {
				onReplace: (remoteDoc: Doc) => {
					const paddedEl = options.padded;
					if (!paddedEl) return;
					paddedEl.innerHTML = remoteDoc.content;
					if (options.getCurrentId()) docs[options.getCurrentId()!] = remoteDoc;
					options.setLastKnownSaveTime(remoteDoc.lastSaved);
					options.setModified(false);

					options.renderSidebar();
				},
				onChange: () => options.renderSidebar()
			});
		}
	});
}

