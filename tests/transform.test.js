const { test } = require('node:test');
global.window = { setTimeout: () => {} };
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return { Plugin: class {}, Notice: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const PluginClass = require('../main.js');
Module._load = originalLoad;
const calls = {};
const app = { workspace: { on: (event, fn) => { calls[event] = fn; return {}; } } };
const plugin = new PluginClass();
plugin.app = app;
plugin.registerEvent = () => {};
const url = 'zotero://open-pdf/library/items/HGACVREL?page=3&annotation=L5RV6EX5';

function editor(initial) {
  let value = initial;
  return {
    getValue: () => value,
    replaceRange: (text, from, to) => {
      const offset = p => value.split('\n').slice(0,p.line).join('\n').length + (p.line ? 1 : 0) + p.ch;
      value = value.slice(0, offset(from)) + text + value.slice(offset(to));
    },
    nativeInsert: text => { value += text; }
  };
}

test('converts a Zotero drag into one page-aware callout and deduplicates footer', async () => {
  await plugin.onload();
  const ed = editor('## Experiments\n\n');
  const inserted = `> [!quote] PDF Highlight\n>\n> In RBO, we test the optimization performance... ([pdf](${url}))\n>\n> 📄 Open PDF · (Tom 等, 2025, p. 3)`;
  calls['editor-drop']({ defaultPrevented: false, dataTransfer: { files: [], getData: t => t === 'text/plain' ? inserted : '' } }, ed);
  ed.nativeInsert(inserted);
  calls['editor-change'](ed);
  const result = ed.getValue();
  assert.match(result, /PDF Highlight · Page 3/);
  assert.match(result, /\[📄 Open PDF\]\(zotero:\/\/open-pdf\//);
  assert.equal((result.match(/Open PDF/g) || []).length, 1);
  assert.match(result, /Tom 等, 2025, p\. 3/);
  assert.doesNotMatch(result, /\[pdf\]/);
});

test('ignores non-Zotero drops', async () => {
  await plugin.onload();
  const ed = editor('Keep me');
  calls['editor-drop']({ defaultPrevented: false, dataTransfer: { files: [], getData: () => 'plain text' } }, ed);
  assert.equal(ed.getValue(), 'Keep me');
});
