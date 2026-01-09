// Sanitize pasted HTML by removing style/class attributes and disallowed elements
export function sanitizeHTML(html: string) {
	if (!html) return '';
	const parser = new DOMParser();
	let doc: Document | null = null;
	try {
		doc = parser.parseFromString(html, 'text/html');
	} catch (e) {
		doc = null;
	}
	// If parsing didn't yield a body, fall back to a wrapper element
	const root: Node = (doc && doc.body) ? doc.body : (() => {
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html;
		return wrapper;
	})();

	const whitelist = new Set([
		'P','BR','B','STRONG','I','EM','SUB','SUP','H1','H2','H3','H4','H5','H6','UL','OL','LI','A','SPAN','DIV','IMG'
	]);
	const allowedAttrs: Record<string, string[]> = { A: ['href', 'title', 'target', 'rel'], IMG: ['src', 'alt', 'title'] };

	function walk(node: Node) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as HTMLElement;
			// remove style, class, and event handler attributes; keep only allowed attributes
			for (const attr of Array.from(el.attributes)) {
				const name = attr.name.toLowerCase();
				if (name === 'style' || name === 'class' || name.startsWith('on')) {
					el.removeAttribute(attr.name);
					continue;
				}
				const allowed = allowedAttrs[el.nodeName];
				if (!allowed || !allowed.includes(attr.name)) {
					el.removeAttribute(attr.name);
				} else if (el.nodeName === 'A' && attr.name === 'href') {
					// basic href sanitization: allow http(s), mailto, or relative
					try {
						const url = new URL(attr.value, window.location.href);
						if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) el.removeAttribute('href');
					} catch (e) {
						el.removeAttribute('href');
					}
				}
			}

			// replace DIV with P for better defaults
			if (el.nodeName === 'DIV') {
				const p = document.createElement('p');
				while (el.firstChild) p.appendChild(el.firstChild);
				el.replaceWith(p);
				walk(p);
				return;
			}

			// unwrap disallowed elements (replace with their children)
			if (!whitelist.has(el.nodeName)) {
				const frag = document.createDocumentFragment();
				while (el.firstChild) frag.appendChild(el.firstChild);
				el.replaceWith(frag);
				// children will be processed in subsequent recursion
			}
		}

		for (const child of Array.from(node.childNodes)) {
			walk(child);
		}
	}

	walk(root);
	return (root && (root as Element).innerHTML) || '';
}
