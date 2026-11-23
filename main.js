const { Plugin, Notice } = require('obsidian');

const PDF_LINK = /\(?\[pdf\]\((zotero:\/\/open-pdf\/[^\s)]+)\)\)?/i;

function transform(input) {
  if (!input || !/zotero:\/\/open-pdf\//i.test(input)) return null;
  const source = input.replace(/\r\n/g, '\n').trim();
  const found = source.match(PDF_LINK);
  if (!found) return null;
  const pdfUrl = found[1];
  let page = '';
  try { page = new URL(pdfUrl).searchParams.get('page') || ''; } catch (_) {}
  let text = source.replace(PDF_LINK, '').trim();
  // Unwrap one existing callout/blockquote layer, then rebuild consistently.
  text = text.split('\n').map(line => line.replace(/^\s*>\s?/, '')).join('\n').trim();
  text = text.replace(/^\[!\w+\][^\n]*\n?/, '').trim();
  // Zotero's note template may already emit an Open PDF footer. Remove that
  // footer label before adding our canonical link, without touching the citation.
  const existingOpenPdf = /(?:\[\s*(?:📄\s*)?Open\s+PDF\s*\]\([^\n)]*\)|(?:📄\s*)?Open\s+PDF)(?:\s*[·•|]\s*)?/gi;
  const lines = text.split('\n').map(line => line.replace(existingOpenPdf, '').trimEnd());
  let citation = '';
  // Only move a trailing citation paragraph, keeping its Markdown links intact.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const candidate = lines[i].trim();
    if (/^\(?[^\n]{1,180}(?:\b(?:19|20)\d{2}\b)[^\n]{0,100}\)?$/.test(candidate) &&
        /\b(?:19|20)\d{2}\b/.test(candidate)) {
      citation = candidate.replace(/^[\s·•|]+/, '').trim();
      lines.splice(i, 1);
    }
    break;
  }
  const body = lines.join('\n').trim();
  if (!body) return null;
  const title = `PDF Highlight${page ? ` · Page ${page}` : ''}`;
  const footer = `[📄 Open PDF](${pdfUrl})${citation ? ` · ${citation}` : ''}`;
  const quoted = body.split('\n').map(line => line ? `> ${line}` : '>').join('\n');
  return `> [!quote] ${title}\n>\n${quoted}\n>\n> ${footer}`;
}

function htmlToMarkdownFallback(html) {
  if (!html || !/zotero:\/\/open-pdf\//i.test(html)) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = [...doc.querySelectorAll('a[href^="zotero://open-pdf/"]')];
  if (!anchors.length) return '';
  const link = anchors[0].getAttribute('href');
  const block = doc.querySelector('blockquote') || doc.body;
  const lines = (block.innerText || block.textContent || '').trim();
  if (!lines) return '';
  return `${lines}\n([pdf](${link}))`;
}

function diffInserted(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const removed = before.slice(start, before.length - end);
  const inserted = after.slice(start, after.length - end);
  return { start, removed, inserted };
}

function offsetToPos(text, offset) {
  const preceding = text.slice(0, offset).split('\n');
  return { line: preceding.length - 1, ch: preceding[preceding.length - 1].length };
}

module.exports = class ZoteroDropCallout extends Plugin {
  async onload() {
    this.pending = new WeakMap();
    this.rewriting = new WeakSet();
    this.registerEvent(this.app.workspace.on('editor-drop', (evt, editor) => {
      if (evt.defaultPrevented || !evt.dataTransfer || evt.dataTransfer.files.length) return;
      const plain = evt.dataTransfer.getData('text/plain') || '';
      const html = evt.dataTransfer.getData('text/html') || '';
      if (!/zotero:\/\/open-pdf\//i.test(plain + html)) return;
      const token = { before: editor.getValue(), at: Date.now(), fallback: plain || htmlToMarkdownFallback(html) };
      this.pending.set(editor, token);
      window.setTimeout(() => {
        if (this.pending.get(editor) !== token) return;
        this.pending.delete(editor);
        const current = editor.getValue();
        const diff = diffInserted(token.before, current);
        const converted = transform(diff.inserted);
        if (converted && !diff.removed && diff.inserted.length < 30000) {
          this.apply(editor, current, diff.start, diff.inserted.length, converted);
        } else if (current === token.before) {
          new Notice('Zotero 高亮未被插入；请在源码/实时预览编辑模式重试。', 4500);
        }
      }, 250);
    }));
    this.registerEvent(this.app.workspace.on('editor-change', (editor) => {
      if (this.rewriting.has(editor)) return;
      const token = this.pending.get(editor);
      if (!token) return;
      const current = editor.getValue();
      const diff = diffInserted(token.before, current);
      if (diff.removed || !diff.inserted || diff.inserted.length > 30000) return;
      const converted = transform(diff.inserted);
      if (!converted) return;
      this.pending.delete(editor);
      this.apply(editor, current, diff.start, diff.inserted.length, converted);
    }));
  }
  apply(editor, current, start, length, converted) {
    this.rewriting.add(editor);
    try {
      editor.replaceRange(converted, offsetToPos(current, start), offsetToPos(current, start + length));
    } finally {
      this.rewriting.delete(editor);
    }
  }
};