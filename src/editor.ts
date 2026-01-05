
export function ensureCaretVisible(padded: HTMLElement) {
	const sel = window.getSelection();
	if (!sel || !sel.rangeCount) return;
	const range = sel.getRangeAt(0).cloneRange();
	range.collapse(false);
	let rect = range.getBoundingClientRect();
	// If rect is empty (some browsers), use last child fallback
	if (!rect || (rect.top === 0 && rect.bottom === 0)) {
		const last = padded.lastElementChild as HTMLElement | null;
		if (last) rect = last.getBoundingClientRect();
		else return;
	}
	const paddedRect = padded.getBoundingClientRect();
	const offset = 12;
	if (rect.bottom > paddedRect.bottom - offset) {
		padded.scrollTop += rect.bottom - paddedRect.bottom + offset;
	} else if (rect.top < paddedRect.top + offset) {
		padded.scrollTop += rect.top - paddedRect.top - offset;
	}
}

// Update toolbar button active states
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
}

// Create the toolbar and wire up handlers. We accept callbacks to avoid tight coupling with app state.
export function createToolbar(
	padded: HTMLElement,
	handlers: {
		saveCurrentDoc: () => void,
		setModified: (v: boolean) => void,
		enforceFont: (p: HTMLElement, font: string) => void,
		getCurrentDocumentFont: () => string
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
			handlers.saveCurrentDoc();
		});
	}

	// update active state when selection changes
	document.addEventListener('selectionchange', () => updateToolbarState(toolbar));
	return toolbar;
}

import type { Doc } from './types';
import { loadDocsFromStorage, checkForExternalUpdates, DOCS_KEY, CURRENT_KEY, POLL_MS } from './store';

export function setupEditor(options: {
	padded: HTMLElement,
	getDocs: () => Record<string, Doc>,
	setDocs: (d: Record<string, Doc>) => void,
	getCurrentId: () => string | null,
	setCurrentId: (id: string | null) => void,
	getLastKnownSaveTime: () => number,
	setLastKnownSaveTime: (t: number) => void,
	saveCurrentDoc: () => void,
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
			options.saveCurrentDoc();
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
			options.saveCurrentDoc();
		}
	});

	// sanitize pasted content and insert clean HTML
	padded.addEventListener('paste', (e: ClipboardEvent) => {
		e.preventDefault();
		const cb = (e.clipboardData ?? (window as any).clipboardData) as DataTransfer | null;
		if (!cb) return;
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
			// preserve line breaks as paragraphs
			const parts = text.replace(/\r\n/g, '\n').split('\n');
			content = parts.map(p => `<p>${options.escapeHtml(p)}</p>`).join('');
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
			window.setTimeout(() => options.saveCurrentDoc(), 0);
			// ensure caret visibility
			window.setTimeout(() => ensureCaretVisible(padded), 0);
		} else if (text) {
			document.execCommand('insertText', false, text);
			options.setModified(true);
			window.setTimeout(() => options.saveCurrentDoc(), 0);
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

