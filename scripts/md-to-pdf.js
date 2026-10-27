'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const files = [
  { md: 'PLAN.md',         pdf: 'output/PLAN.pdf' },
  { md: 'SPEC.md',         pdf: 'output/SPEC.pdf' },
  { md: 'REQUIREMENTS.md', pdf: 'output/REQUIREMENTS.pdf' },
];

// Minimal GitHub-style Markdown → HTML converter (no external deps)
function mdToHtml(md) {
  let html = md
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang}">${escHtml(code.trimEnd())}</code></pre>`)
    // Inline code
    .replace(/`([^`\n]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    // Headings
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm,  '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm,   '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm,    '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm,     '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm,      '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr>')
    // Blockquote
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    // Tables
    .replace(/(?:^[|].+[|]\n)+/gm, block => {
      const rows = block.trim().split('\n');
      let tableHtml = '<table>\n';
      rows.forEach((row, i) => {
        if (/^\|[-| :]+\|$/.test(row)) return; // separator row
        const cells = row.split('|').slice(1, -1).map(c => c.trim());
        const tag = i === 0 ? 'th' : 'td';
        tableHtml += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>\n';
      });
      tableHtml += '</table>\n';
      return tableHtml;
    })
    // Unordered lists
    .replace(/((?:^[-*+]\s.+\n?)+)/gm, block => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[-*+]\s/, '').trim()}</li>`).join('\n');
      return `<ul>\n${items}\n</ul>\n`;
    })
    // Ordered lists
    .replace(/((?:^\d+\.\s.+\n?)+)/gm, block => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\.\s/, '').trim()}</li>`).join('\n');
      return `<ol>\n${items}\n</ol>\n`;
    })
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Paragraphs (wrap bare text lines)
    .replace(/^(?!<[a-z/]|$)(.+)$/gm, '<p>$1</p>');

  return html;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function wrapHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #24292e;
    padding: 40px 56px;
    max-width: 960px;
    margin: 0 auto;
  }
  h1 { font-size: 2em;   border-bottom: 1px solid #eaecef; padding-bottom: .3em; margin: 1.5em 0 .5em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; margin: 1.5em 0 .5em; }
  h3 { font-size: 1.25em; margin: 1.2em 0 .4em; }
  h4, h5, h6 { font-size: 1em; margin: 1em 0 .3em; }
  p  { margin: .6em 0; }
  ul, ol { padding-left: 2em; margin: .6em 0; }
  li { margin: .2em 0; }
  pre {
    background: #f6f8fa;
    border-radius: 6px;
    padding: 14px 16px;
    overflow-x: auto;
    margin: 1em 0;
    font-size: 12px;
    line-height: 1.45;
  }
  code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 85%;
    background: rgba(27,31,35,.05);
    padding: .2em .4em;
    border-radius: 3px;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    font-size: 12px;
  }
  th, td {
    border: 1px solid #dfe2e5;
    padding: 8px 13px;
    text-align: left;
  }
  th { background: #f6f8fa; font-weight: 600; }
  tr:nth-child(even) td { background: #fafbfc; }
  hr { border: none; border-top: 1px solid #eaecef; margin: 1.5em 0; }
  blockquote {
    border-left: 4px solid #dfe2e5;
    color: #6a737d;
    padding: .5em 1em;
    margin: 1em 0;
  }
  a { color: #0366d6; text-decoration: none; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function convert() {
  // Ensure output directory exists
  if (!fs.existsSync('output')) fs.mkdirSync('output', { recursive: true });

  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  for (const { md, pdf } of files) {
    if (!fs.existsSync(md)) {
      console.error(`Skipping ${md} — file not found`);
      continue;
    }

    console.log(`Converting ${md} → ${pdf} ...`);

    const mdContent   = fs.readFileSync(md, 'utf8');
    const title       = path.basename(md, '.md');
    const htmlContent = wrapHtml(title, mdToHtml(mdContent));

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });

    await page.pdf({
      path:   pdf,
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });

    await page.close();
    console.log(`  ✓ ${pdf}`);
  }

  await browser.close();
  console.log('\nDone.');
}

convert().catch(err => { console.error(err); process.exit(1); });
