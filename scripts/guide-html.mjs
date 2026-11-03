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
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --ink: #1f2937; --muted: #6b7280; --line: #e5e7eb; --accent: #2563eb; --soft: #eff4ff; --bg: #f6f7f9; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif; color: var(--ink); background: var(--bg); line-height: 1.75; font-size: 16px; }
header { background: linear-gradient(135deg, #1e3a8a, #2563eb); color: #fff; padding: 36px 24px 28px; }
header h1 { margin: 0 auto; max-width: 980px; font-size: 28px; }
header p { margin: 6px auto 0; max-width: 980px; opacity: 0.85; }
.wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 60px; display: grid; grid-template-columns: 220px 1fr; gap: 24px; }
nav { position: sticky; top: 16px; align-self: start; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
nav a { display: block; padding: 5px 10px; border-radius: 8px; color: var(--ink); text-decoration: none; font-size: 14px; }
nav a:hover { background: var(--soft); color: var(--accent); }
section { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
h2 { margin: 0 0 10px; font-size: 20px; display: flex; align-items: center; gap: 10px; }
h2 .num { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 14px; }
ol, ul { margin: 6px 0; padding-left: 1.6em; }
li { margin: 4px 0; }
li > ul, li > ol { margin-top: 2px; }
ul.circled { list-style: none; padding-left: 1.6em; }
ul.circled > li::before { content: attr(data-mark); margin-left: -1.4em; width: 1.4em; display: inline-block; color: var(--accent); font-weight: 700; }
.ui { background: var(--soft); color: #1d4ed8; border-radius: 4px; padding: 0 2px; white-space: nowrap; }
pre { background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-family: Consolas, "SF Mono", monospace; font-size: 14px; line-height: 1.6; }
footer { text-align: center; color: var(--muted); font-size: 13px; }
@media (max-width: 760px) { .wrap { grid-template-columns: 1fr; } nav { position: static; } }
@media print { nav { display: none; } .wrap { display: block; } section { break-inside: avoid; border: 0; padding: 0 0 12px; } header { color: #000; background: none; padding: 0 0 12px; } }
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><p>版本 ${esc(version)}　｜　所有資料存在這台電腦的 data 資料夾，不會上傳網路</p></header>
<div class="wrap">
<nav>${toc}</nav>
<main>
${body}
<footer>社區帳務管理 ${esc(version)}</footer>
</main>
</div>
</body>
</html>
`;
}
