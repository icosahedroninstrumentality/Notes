import { escapeHtml } from './html';

// Minimal markdown-to-HTML converter focused on common paste scenarios.
// Supports headings (#), unordered/ordered lists, paragraphs, code fences, inline code,
// bold/italic, links [text](url) and images ![alt](url).
export function convertMarkdownToHtml(md: string) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let i = 0;
    let inCode = false;
    let codeBuffer: string[] = [];

    function flushParagraph(buf: string[]) {
        if (!buf.length) return;
        out.push('<p>' + buf.join(' ') + '</p>');
        buf.length = 0;
    }

    while (i < lines.length) {
        let line = lines[i];

        // code fence
        if (line.trim().startsWith('```')) {
            if (!inCode) { inCode = true; codeBuffer = []; i++; continue; }
            else { // closing fence
                out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
                inCode = false; codeBuffer = []; i++; continue;
            }
        }

        if (inCode) {
            codeBuffer.push(line);
            i++;
            continue;
        }

        // headings
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            flushParagraph([]);
            const level = Math.min(6, h[1].length);
            out.push(`<h${level}>${inlineFormat(h[2])}</h${level}>`);
            i++;
            continue;
        }

        // unordered list
        const ulLines: string[] = [];
        while (i < lines.length && lines[i].trim().match(/^([\*-])\s+(.+)/)) {
            const m = lines[i].trim().match(/^([\*-])\s+(.+)/);
            if (m) ulLines.push(m[2]);
            i++;
        }
        if (ulLines.length) {
            out.push('<ul>' + ulLines.map(l => `<li>${inlineFormat(l)}</li>`).join('') + '</ul>');
            continue;
        }

        // ordered list
        const olLines: string[] = [];
        while (i < lines.length && lines[i].trim().match(/^\d+\.\s+(.+)/)) {
            const m = lines[i].trim().match(/^\d+\.\s+(.+)/);
            if (m) olLines.push(m[1]);
            i++;
        }
        if (olLines.length) {
            out.push('<ol>' + olLines.map(l => `<li>${inlineFormat(l)}</li>`).join('') + '</ol>');
            continue;
        }

        // blank line => paragraph break
        if (!line.trim()) {
            out.push('');
            i++;
            continue;
        }

        // collect paragraph lines
        const paraBuf: string[] = [];
        while (i < lines.length && lines[i].trim()) {
            paraBuf.push(inlineFormat(lines[i]));
            i++;
        }
        out.push('<p>' + paraBuf.join(' ') + '</p>');
    }

    return out.filter(Boolean).join('');
}

function inlineFormat(s: string) {
    let r = escapeHtml(s);
    // images ![alt](url)
    r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
        return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}">`;
    });
    // links [text](url)
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => {
        return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(txt)}</a>`;
    });
    // bold **text** or __text__
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // italic *text* or _text_
    r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/_([^_]+)_/g, '<em>$1</em>');
    // inline code `code`
    r = r.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);
    return r;
}

function escapeAttr(s: string) {
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}