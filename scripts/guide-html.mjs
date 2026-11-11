// 把 docs/使用說明.txt 轉成圖文版 使用說明.html（同一份內容，不必維護兩份）。
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/「([^」]+)」/g, '<span class="ui">「$1」</span>');

const MARKER = /^(\d+\.|-|·|[①②③④⑤⑥⑦⑧⑨])\s*/;

/** 依縮排把一段文字轉成巢狀清單；沒有清單符號的行接在上一個項目後面。 */
function renderBlock(lines) {
  const root = { children: [], level: -1 };
  const stack = [root];
  const paras = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const m = text.match(MARKER);
    if (m) {
      const item = { marker: m[1], text: text.slice(m[0].length), indent, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      stack[stack.length - 1].children.push(item);
      stack.push(item);
    } else if (stack.length > 1) {
      stack[stack.length - 1].text += '\n' + text;
    } else {
      paras.push(text);
    }
  }
  const list = (items) => {
    if (!items.length) return '';
    const ordered = /^\d+\.$/.test(items[0].marker);
    const tag = ordered ? 'ol' : 'ul';
    const cls = /[①-⑨]/.test(items[0].marker) ? ' class="circled"' : '';
    return `<${tag}${cls}>${items
      .map((i) => `<li${cls ? ` data-mark="${i.marker}"` : ''}>${inline(i.text).replace(/\n/g, '<br>')}${list(i.children)}</li>`)
      .join('')}</${tag}>`;
  };
  return paras.map((p) => `<p>${inline(p)}</p>`).join('') + list(root.children);
}

export function guideHtml(txt, version) {
  const lines = txt.replace(/\r/g, '').split('\n');
  const title = lines[0].trim();
  const sections = [];
  let cur = null;
  for (const line of lines.slice(1)) {
    const m = line.match(/^【(.+)】\s*(.*)$/);
    if (m) {
      cur = { title: m[1], lines: m[2] ? [m[2]] : [] };
      sections.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  const body = sections
    .map((s, i) => {
      const id = `s${i + 1}`;
      const content = s.title === '資料夾結構' ? `<pre>${esc(s.lines.join('\n').trim())}</pre>` : renderBlock(s.lines);
      return `<section id="${id}"><h2><span class="num">${i + 1}</span>${esc(s.title)}</h2>${content}</section>`;
    })
    .join('\n');
  const toc = sections.map((s, i) => `<a href="#s${i + 1}">${esc(s.title)}</a>`).join('');
  return `<!doctype html>
<html lang="zh-Hant" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --ink: #1f2933; --muted: #66727f; --line: #dde1e6; --accent: #1f6feb; --accent-strong: #1d4ed8; --soft: #e8f0fe; --bg: #f5f6f8; --panel: #fff; --pre: #0f172a; --head: linear-gradient(135deg, #1e3a8a, #2563eb); color-scheme: light; }
:root[data-theme="dark"] { --ink: #e3e8ee; --muted: #9aa6b4; --line: #263140; --accent: #4c8dff; --accent-strong: #7fb0ff; --soft: rgba(47, 123, 245, 0.18); --bg: #0f141b; --panel: #161d26; --pre: #0a0e13; --head: linear-gradient(135deg, #14213d, #1e3a8a); color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Pretendard", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif; color: var(--ink); background: var(--bg); line-height: 1.75; font-size: 16px; -webkit-font-smoothing: antialiased; }
header { background: var(--head); color: #fff; padding: 32px 24px 26px; }
.head { max-width: 1040px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
header h1 { margin: 0; font-size: 26px; display: flex; align-items: center; gap: 12px; }
header p { margin: 4px 0 0; opacity: 0.85; font-size: 14px; }
.theme { display: inline-flex; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 999px; padding: 2px; background: rgba(255, 255, 255, 0.1); }
.theme button { font: inherit; font-size: 13px; border: 0; background: none; color: rgba(255, 255, 255, 0.85); padding: 4px 14px; border-radius: 999px; cursor: pointer; }
.theme button.on { background: #fff; color: #1e3a8a; font-weight: 700; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 60px; display: grid; grid-template-columns: 230px 1fr; gap: 24px; }
nav { position: sticky; top: 16px; align-self: start; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 10px; max-height: calc(100vh - 32px); overflow-y: auto; }
nav a { display: block; padding: 6px 10px; border-radius: 9px; color: var(--ink); text-decoration: none; font-size: 14px; }
nav a:hover { background: var(--soft); color: var(--accent-strong); }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; margin-bottom: 16px; }
h2 { margin: 0 0 10px; font-size: 20px; display: flex; align-items: center; gap: 10px; }
h2 .num { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 14px; }
ol, ul { margin: 6px 0; padding-left: 1.6em; }
li { margin: 4px 0; }
li::marker { color: var(--accent); }
li > ul, li > ol { margin-top: 2px; }
ul.circled { list-style: none; padding-left: 1.6em; }
ul.circled > li::before { content: attr(data-mark); margin-left: -1.4em; width: 1.4em; display: inline-block; color: var(--accent); font-weight: 700; }
.ui { background: var(--soft); color: var(--accent-strong); border-radius: 5px; padding: 0 3px; white-space: nowrap; }
pre { background: var(--pre); color: #e2e8f0; padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-family: Consolas, "SF Mono", monospace; font-size: 14px; line-height: 1.6; }
footer { text-align: center; color: var(--muted); font-size: 13px; }
@media (max-width: 760px) { .wrap { grid-template-columns: 1fr; } nav { position: static; max-height: none; } }
@media print {
  :root, :root[data-theme="dark"] { --ink: #000; --muted: #444; --line: #ccc; --accent: #1f6feb; --accent-strong: #1d4ed8; --soft: transparent; --bg: #fff; --panel: #fff; color-scheme: light; }
  nav, .theme { display: none; } .wrap { display: block; } section { break-inside: avoid; border: 0; padding: 0 0 12px; } header { color: #000; background: none; padding: 0 0 12px; }
}
</style>
</head>
<body>
<header><div class="head"><div><h1>${esc(title)}</h1><p>版本 ${esc(version)}　｜　所有資料存在這台電腦的 data 資料夾，不會上傳網路</p></div>
<div class="theme" role="group" aria-label="畫面配色"><button data-t="light">淺色</button><button data-t="dark">深色</button></div></div></header>
<div class="wrap">
<nav>${toc}</nav>
<main>
${body}
<footer>社區帳務管理 ${esc(version)}</footer>
</main>
</div>
<script>
(function () {
  var root = document.documentElement, key = 'guide-theme';
  function apply(t) { root.dataset.theme = t; document.querySelectorAll('.theme button').forEach(function (b) { b.className = b.dataset.t === t ? 'on' : ''; }); }
  var saved = null;
  try { saved = localStorage.getItem(key); } catch (e) {}
  apply(saved === 'light' ? 'light' : 'dark');
  document.querySelectorAll('.theme button').forEach(function (b) {
    b.addEventListener('click', function () { apply(b.dataset.t); try { localStorage.setItem(key, b.dataset.t); } catch (e) {} });
  });
})();
</script>
</body>
</html>
`;
}
