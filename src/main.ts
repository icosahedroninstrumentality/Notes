import { now, saveDocsToStorage, CURRENT_KEY, loadImagesFromStorage } from './store';
import { sanitizeHTML } from './utils/sanitize';
import { createToolbar, updateToolbarState, ensureCaretVisible, setupEditor } from './editor';
import { escapeHtml } from './utils/html';
import type { Doc } from './types';

import { BG_KEY, BG_DISABLED_KEY, loadBgFromStorage, saveBgToStorage, loadBgDisabledFromStorage, saveBgDisabledToStorage } from './store';

let docs: Record<string, Doc> = {};
let currentId: string | null = null;
let lastKnownSaveTime = 0;
let modified = false;
modified; // shut-up-typescript hack

function fmtTime(ts: number) {
	return new Date(ts).toLocaleTimeString();
}

function updateHeader(doc: Doc) {
	const header = document.getElementById('doc-header');
	if (!header) return;
	header.textContent = `${fmtTime(doc.lastSaved)} — ${doc.title}`;
	// keep the browser tab title in sync with the opened document
	document.title = doc.title;
}

function makeSidebar() {
	const sidebar = document.querySelector('sidebar');
	if (!sidebar) return null;
	const list = sidebar.querySelector('.doc-list') as HTMLElement | null;
	const newBtn = sidebar.querySelector('.new-doc') as HTMLButtonElement | null;
	if (newBtn) {
		// Use onclick assignment so repeated calls to makeSidebar() don't add multiple listeners
		newBtn.onclick = () => createNewDoc();
	}
	return list;
}

function renderSidebar() {
	const list = makeSidebar();
	if (!list) return;
	list.innerHTML = '';
	const keys = Object.keys(docs).sort((a, b) => docs[b].lastSaved - docs[a].lastSaved);
	for (const id of keys) {
		const doc = docs[id];
		const row = document.createElement('div');
		row.className = 'doc-item';
		if (id === currentId) {
			row.classList.add('active');
			row.setAttribute('aria-current', 'true');
		} else {
			row.removeAttribute('aria-current');
		}

		let clickTimer: number | null = null;
		const title = document.createElement('div');
		title.className = 'doc-title';
		title.textContent = doc.title || '(untitled)';
		// double-click the title to rename
		title.title = 'Double-click to rename';
		title.addEventListener('dblclick', (e) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			// clear any pending row click selection
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
			// clear any existing selection (avoid accidental formatting triggers)
			const sel = window.getSelection();
			if (sel) sel.removeAllRanges();
			const input = document.createElement('input');
			input.type = 'text';
			input.className = 'doc-title-input';
			input.value = doc.title || '';
			title.replaceWith(input);
			input.focus();
			input.select();

			const saveTitle = () => {
				const newTitle = (input.value || '').trim() || '(untitled)';
				if (newTitle !== doc.title) {
					doc.title = newTitle;
					doc.lastSaved = now();
					if (id === currentId) lastKnownSaveTime = doc.lastSaved;
				saveDocsToStorage(docs);
					if (id === currentId) updateHeader(docs[id]);
					renderSidebar();

				} else {
					renderSidebar();
				}
			};

			input.addEventListener('keydown', (ke) => {
				if (ke.key === 'Enter') {
					ke.preventDefault();
					saveTitle();
				} else if (ke.key === 'Escape') {
					ke.preventDefault();
					renderSidebar();
				}
			});

			input.addEventListener('blur', () => {
				saveTitle();
			});
		});
		row.appendChild(title);

		const meta = document.createElement('div');
		meta.className = 'doc-meta';
		meta.textContent = fmtTime(doc.lastSaved);
		row.appendChild(meta);

		const actions = document.createElement('div');
		actions.className = 'doc-actions';
		const del = document.createElement('button');
		del.textContent = 'Delete';
		del.className = 'doc-delete';
		del.addEventListener('click', (e) => {
			e.stopPropagation();
			deleteDoc(id);
		});
		actions.appendChild(del);
		row.appendChild(actions);

		row.addEventListener('click', () => {
			// schedule select with a short delay so a following dblclick can cancel it
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
			clickTimer = window.setTimeout(() => { selectDoc(id); clickTimer = null; }, 200);
		});
		row.addEventListener('dblclick', (e) => {
			// cancel any pending click selection
			if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
			e.stopPropagation();
		});

		list.appendChild(row);

		// if this is the active document, ensure it's visible in the sidebar
		if (id === currentId) {
			try { row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
		}
	}
}

function createNewDoc(title = 'New note') {
	const id = 'doc-' + Date.now();
	docs[id] = {
		id,
		title,
		content: '<p></p>',
		lastSaved: now(),
		font: 'Arial, Helvetica, sans-serif',
	};
	saveDocsToStorage(docs);
	renderSidebar();
	selectDoc(id);
}

function deleteDoc(id: string) {
	if (!docs[id]) return;
	delete docs[id];
	saveDocsToStorage(docs);
	if (id === currentId) {
		const remaining = Object.keys(docs);
		if (remaining.length) selectDoc(remaining[0]);
		else createNewDoc();
	}
	renderSidebar();
}

function selectDoc(id: string) {
	const padded = document.querySelector('padded') as HTMLElement | null;
	if (!padded) return;
	const doc = docs[id];
	if (!doc) return;
	currentId = id;
	padded.innerHTML = doc.content;
	// resolve notes:image:{id} placeholders to actual data URLs for display (do not mutate stored content)
	try {
		const imagesMap = loadImagesFromStorage();
		for (const img of Array.from(padded.querySelectorAll('img')) as HTMLImageElement[]) {
			const src = img.getAttribute('src') || '';
			if (src.startsWith('notes:image:')) {
				const id = src.slice('notes:image:'.length);
				const data = imagesMap[id];
				if (data) {
					img.setAttribute('data-image-id', id);
					img.src = data; // display data URL, but keep placeholder in stored content
				}
			}
		}
	} catch (e) { /* ignore image resolution errors */ }
	// apply per-document font and enforce it throughout the content
	enforceFont(padded, doc.font || 'Arial, Helvetica, sans-serif');
	lastKnownSaveTime = doc.lastSaved;
	setModified(false);
	localStorage.setItem(CURRENT_KEY, id);
	renderSidebar();
	// update font selector if present
	const fontSel = document.getElementById('font-selector') as HTMLSelectElement | null;
	if (fontSel) fontSel.value = doc.font || 'Arial, Helvetica, sans-serif';

	// Focus the editor and place the caret at the end so users can start typing immediately
	try {
		padded.focus();
		const sel = window.getSelection();
		if (sel) {
			sel.removeAllRanges();
			const range = document.createRange();
			// find the deepest last node to place the caret
			let node: Node | null = padded;
			while (node && node.lastChild) node = node.lastChild;
			if (node) {
				if (node.nodeType === Node.TEXT_NODE) {
					range.setStart(node, (node.textContent || '').length);
				} else {
					// ensure there's a place to put the caret
					const t = document.createTextNode('');
					(node as HTMLElement).appendChild(t);
					range.setStart(t, 0);
				}
			} else {
				const t = document.createTextNode('');
				padded.appendChild(t);
				range.setStart(t, 0);
			}
			range.collapse(true);
			sel.addRange(range);
		}
	} catch (e) {}
	// ensure caret is visible inside the padded scroller
	window.setTimeout(() => ensureCaretVisible(padded), 0);

	updateHeader(doc);
}

function setModified(v: boolean) {
	modified = v;
}

function saveCurrentDoc() {
	if (!currentId) return;
	const padded = document.querySelector('padded') as HTMLElement | null;
	if (!padded) return;

	// Before saving, ensure any displayed data-URLs are replaced with notes:image:{id} placeholders
	const imagesMap = loadImagesFromStorage();
	const restored: {img: HTMLImageElement, id: string, prevSrc: string}[] = [];
	for (const img of Array.from(padded.querySelectorAll('img')) as HTMLImageElement[]) {
		let id = img.getAttribute('data-image-id') || '';
		const src = img.getAttribute('src') || '';
		if (!id && src.startsWith('data:')) {
			// try to find existing id for this data URL
			id = Object.keys(imagesMap).find(k => imagesMap[k] === src) || '';
		}
		if (id) {
			restored.push({ img, id, prevSrc: src });
			img.setAttribute('src', `notes:image:${id}`);
		}
	}

	docs[currentId].content = padded.innerHTML;
	docs[currentId].lastSaved = now();
	lastKnownSaveTime = docs[currentId].lastSaved;
	saveDocsToStorage(docs);
	setModified(false);
	renderSidebar();
	if (currentId) updateHeader(docs[currentId]);

	// restore the data URLs back into the DOM so the editor keeps showing images
	for (const r of restored) {
		const data = imagesMap[r.id];
		if (data) r.img.src = data; else r.img.setAttribute('src', r.prevSrc);
	}
}

function clearAllFormatting(padded: HTMLElement) {
	const sel = window.getSelection();
	if (!sel) return;
	const unwrapSelectors = 'sub,sup,b,strong,i,em,span,u,mark';

	// If there's a selection, operate only on that range
	if (sel.rangeCount && !sel.isCollapsed) {
		const range = sel.getRangeAt(0);
		// Use browser removeFormat on selection
		try { document.execCommand('removeFormat', false); } catch (e) {}

		// Convert any headings that intersect the selection into paragraphs
		for (const h of Array.from(padded.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
			if (range.intersectsNode(h)) {
				const p = document.createElement('p');
				while (h.firstChild) p.appendChild(h.firstChild);
				h.replaceWith(p);
			}
		}

		// Unwrap inline formatting elements that intersect the selection
		for (const el of Array.from(padded.querySelectorAll(unwrapSelectors))) {
			if (range.intersectsNode(el)) {
				const frag = document.createDocumentFragment();
				while (el.firstChild) frag.appendChild(el.firstChild);
				el.replaceWith(frag);
			}
		}

		// Remove style/class attributes from elements that intersect the selection
		for (const el of Array.from(padded.querySelectorAll('*'))) {
			if (range.intersectsNode(el)) {
				(el as HTMLElement).removeAttribute('style');
				(el as HTMLElement).removeAttribute('class');
			}
		}

		setModified(true);
		return;
	}

	// If collapsed, operate on the current block/line containing the caret
	let node: Node | null = sel.anchorNode;
	if (!node) return;
	// climb up to a sensible block element
	let block = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement as Element | null);
	while (block && block !== padded && !/^(P|DIV|H1|H2|H3|H4|H5|H6)$/i.test(block.nodeName)) {
		block = block.parentElement;
	}
	if (!block || block === padded) return;

	// Select block contents and remove inline formatting
	const r = document.createRange();
	r.selectNodeContents(block);
	sel.removeAllRanges();
	sel.addRange(r);
	try { document.execCommand('removeFormat', false); } catch (e) {}

	if (/^H[1-6]$/i.test(block.nodeName)) {
		const p = document.createElement('p');
		while (block.firstChild) p.appendChild(block.firstChild);
		block.replaceWith(p);
		block = p;
	}

	for (const el of Array.from((block as Element).querySelectorAll(unwrapSelectors))) {
		const frag = document.createDocumentFragment();
		while (el.firstChild) frag.appendChild(el.firstChild);
		el.replaceWith(frag);
	}

	for (const el of Array.from((block as Element).querySelectorAll('*'))) {
		(el as HTMLElement).removeAttribute('style');
		(el as HTMLElement).removeAttribute('class');
	}

	// collapse selection to end of the block
	sel.removeAllRanges();
	const collapseRange = document.createRange();
	collapseRange.setStart(block, block.childNodes.length);
	collapseRange.collapse(true);
	sel.addRange(collapseRange);

	setModified(true);
}
(window as any).clearAllFormatting = clearAllFormatting;

// Enforce a document font by setting it on the padded container and removing any
// inline font-family from child elements so everything inherits the document font.
function enforceFont(padded: HTMLElement, font: string) {
	padded.style.fontFamily = font || 'Arial, Helvetica, sans-serif';
	for (const el of Array.from(padded.querySelectorAll('*'))) {
		try {
			(el as HTMLElement).style.fontFamily = '';
		} catch (e) {}
	}
}

function initEditor() {
	const padded = document.querySelector('padded') as HTMLElement | null;
	if (!padded) return;
	const sidebar = document.querySelector('sidebar');
	if (!sidebar) return;

	// Background hue slider (static UI in the sidebar header). Brightness (lightness) is fixed at 10%.
	const root = document.documentElement;
	const bgPicker = sidebar.querySelector('#bg-picker') as HTMLInputElement | null;
	const bgToggle = sidebar.querySelector('#bg-toggle') as HTMLButtonElement | null;
	const savedBg = loadBgFromStorage();
	const savedDisabled = loadBgDisabledFromStorage();
	if (savedBg && !savedDisabled) root.style.setProperty('--bg', savedBg);

	function hexToRgb(hex: string) {
		if (!hex) return null;
		hex = hex.replace('#', '');
		if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
		if (hex.length !== 6) return null;
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16)
		};
	}

	function rgbToHsl(r: number, g: number, b: number) {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		let h = 0, s = 0, l = (max + min) / 2;
		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h *= 60;
		}
		return { h, s: s * 100, l: l * 100 };
	}

	function saveBgColor(color: string) {
		saveBgToStorage(color);
	}

	let disabled = !!savedDisabled;

	function setHue(h: number) {
		const color = `hsl(${h}, 100%, 10%)`;
		saveBgColor(color);
		if (!disabled) {
			root.style.setProperty('--bg', color);
		}
	}

	// initialize slider position from saved value (supports hsl(...) or hex)
	let initHue = 0;
	if (savedBg) {
		const m = savedBg.match(/hsl\s*\(\s*(\d+(?:\.\d+)?)/i);
		if (m) {
			initHue = Math.round(Number(m[1]));
		} else {
			const rgb = hexToRgb(savedBg);
			if (rgb) {
				const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
				initHue = Math.round(hsl.h);
			}
		}
	}

	if (bgPicker) {
		bgPicker.value = String(initHue);
		bgPicker.disabled = disabled; 
		if (bgToggle) {
			bgToggle.setAttribute('aria-pressed', !disabled ? 'true' : 'false');
			bgToggle.innerText = disabled ? 'Off' : 'On';
			bgToggle.addEventListener('click', () => {
				disabled = !disabled;
				bgToggle.setAttribute('aria-pressed', !disabled ? 'true' : 'false');
				bgToggle.innerText = disabled ? 'Off' : 'On';
				bgPicker.disabled = disabled;
				saveBgDisabledToStorage(disabled);
				if (disabled) {
					root.style.setProperty('--bg', 'black');
				} else {
					// restore from saved color or fall back
					const restore = loadBgFromStorage() || 'hsl(0, 0%, 10%)';
					root.style.setProperty('--bg', restore);
				}
			});
		}

		bgPicker.addEventListener('input', (e) => {
			const h = Number((e.target as HTMLInputElement).value);
			setHue(h);
		});
	}

	// react to storage changes from other tabs/windows (sync hue and disabled state)
	window.addEventListener('storage', (e) => {
		if (e.key === BG_KEY) {
			const val = e.newValue;
			if (val) {
				if (!disabled) root.style.setProperty('--bg', val);
				const picker = document.getElementById('bg-picker') as HTMLInputElement | null;
				if (picker) {
					const m = String(val).match(/hsl\s*\(\s*(\d+(?:\.\d+)?)/i);
					let h = 0;
					if (m) h = Math.round(Number(m[1]));
					else {
						const rgb = hexToRgb(String(val));
						if (rgb) h = Math.round(rgbToHsl(rgb.r, rgb.g, rgb.b).h);
					}
					picker.value = String(h);
				}

			}
		} else if (e.key === BG_DISABLED_KEY) {
			const v = e.newValue === '1';
			disabled = v;
			if (disabled) {
				root.style.setProperty('--bg', 'hsl(0, 0%, 10%)');
				const picker = document.getElementById('bg-picker') as HTMLInputElement | null;
				if (picker) picker.disabled = true;
				if (bgToggle) { bgToggle.setAttribute('aria-pressed', 'true'); bgToggle.textContent = 'On'; }
			} else {
				const restore = loadBgFromStorage() || 'hsl(0, 0%, 10%)';
				root.style.setProperty('--bg', restore);
				const picker = document.getElementById('bg-picker') as HTMLInputElement | null;
				if (picker) picker.disabled = false;
				if (bgToggle) { bgToggle.setAttribute('aria-pressed', 'false'); bgToggle.textContent = 'Off'; }
			}
		}
	});

	// add toolbar (we don't need to reference the return value here)
	createToolbar(padded, {
		saveCurrentDoc,
		setModified,
		enforceFont,
		getCurrentDocumentFont: () => (currentId && docs[currentId]) ? docs[currentId].font || 'Arial, Helvetica, sans-serif' : 'Arial, Helvetica, sans-serif',
		setCurrentDocumentFont: (font: string) => {
			if (!currentId) return;
			docs[currentId].font = font;
			docs[currentId].lastSaved = now();
			lastKnownSaveTime = docs[currentId].lastSaved;
			saveDocsToStorage(docs);
			// apply font immediately and update UI
			const paddedEl = document.querySelector('padded') as HTMLElement | null;
			if (paddedEl) enforceFont(paddedEl, font);
			setModified(false);
			renderSidebar();
			updateHeader(docs[currentId]);
		}
	});

	setupEditor({
		padded,
		getDocs: () => docs,
		setDocs: (d) => { docs = d; },
		getCurrentId: () => currentId,
		setCurrentId: (id) => { currentId = id; },
		getLastKnownSaveTime: () => lastKnownSaveTime,
		setLastKnownSaveTime: (t) => { lastKnownSaveTime = t; },
		saveCurrentDoc,
		setModified,
		updateToolbarState,
		sanitizeHTML,
		escapeHtml,
		createNewDoc,
		selectDoc,
		renderSidebar,
		updateHeader
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initEditor);
} else {
	initEditor();
}
