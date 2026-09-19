// 麻將學園:策略教學文章頁。內容資料在 academyContent.js,這裡只負責把它畫出來,
// 並且把文字裡提到的牌型(tileGroups)畫成小張牌圖示,方便直接對照看懂在講哪些牌。

import { parseHand } from '../src/handNotation.js';
import { tileDisplayName } from '../src/tiles.js';
import { tileImageSrc } from './tileAssets.js';
import { chapters, overview } from './academyContent.js';

// 文字裡用 **粗體** 標記重點,這裡轉成真正的 <strong>,其餘原樣輸出。
function appendRich(parent, text) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  parts.forEach((part, i) => {
    if (part === '') return;
    if (i % 2 === 1) {
      const strong = document.createElement('strong');
      strong.textContent = part;
      parent.appendChild(strong);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function richP(text, className) {
  const p = document.createElement('p');
  if (className) p.className = className;
  appendRich(p, text);
  return p;
}

function tileChip(tile) {
  const span = document.createElement('span');
  span.className = 'academy-chip';
  const img = document.createElement('img');
  img.src = tileImageSrc(tile);
  img.alt = tileDisplayName(tile);
  img.draggable = false;
  span.appendChild(img);
  return span;
}

// notation 用專案既有記牌法,例如 "89s"(89條)、"57m"(57萬)、"77z"(白板對子,z7=白)
function renderTileGroup(group) {
  const wrap = document.createElement('div');
  wrap.className = 'academy-tile-group';

  const label = document.createElement('span');
  label.className = 'academy-tile-group-label';
  label.textContent = group.label;
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.className = 'academy-tile-group-row';
  for (const tile of parseHand(group.notation)) {
    row.appendChild(tileChip(tile));
  }
  wrap.appendChild(row);

  return wrap;
}

function renderTileGroups(groups) {
  const wrap = document.createElement('div');
  wrap.className = 'academy-tile-groups';
  for (const group of groups) wrap.appendChild(renderTileGroup(group));
  return wrap;
}

// item 可以是純字串,也可以是 { text, tileGroups?, children? }(children 是縮排的子清單,一律用 ul)
function renderListItem(item) {
  const li = document.createElement('li');
  const text = typeof item === 'string' ? item : item.text;
  appendRich(li, text);

  if (typeof item === 'object' && item.tileGroups) {
    li.appendChild(renderTileGroups(item.tileGroups));
  }

  if (typeof item === 'object' && item.children) {
    const sub = document.createElement('ul');
    sub.className = 'academy-sublist';
    for (const child of item.children) sub.appendChild(renderListItem(child));
    li.appendChild(sub);
  }

  return li;
}

function renderList(block, container) {
  const list = document.createElement(block.type === 'ol' ? 'ol' : 'ul');
  for (const item of block.items) list.appendChild(renderListItem(item));
  container.appendChild(list);
}

function renderTable(block, container) {
  const wrap = document.createElement('div');
  wrap.className = 'academy-table-wrap';
  const table = document.createElement('table');
  table.className = 'academy-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of block.headers) {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of block.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderBlock(block, container) {
  if (block.type === 'p') {
    container.appendChild(richP(block.text));
  } else if (block.type === 'h4') {
    const h4 = document.createElement('h4');
    h4.className = 'academy-h4';
    appendRich(h4, block.text);
    container.appendChild(h4);
  } else if (block.type === 'ul' || block.type === 'ol') {
    renderList(block, container);
  } else if (block.type === 'table') {
    renderTable(block, container);
  } else if (block.type === 'formula') {
    const pre = document.createElement('p');
    pre.className = 'academy-formula';
    pre.textContent = block.text;
    container.appendChild(pre);
  }
}

function renderChapterContent(chapter, container) {
  const title = document.createElement('h2');
  title.textContent = chapter.title;
  container.appendChild(title);

  for (const block of chapter.blocks ?? []) renderBlock(block, container);

  for (const section of chapter.sections ?? []) {
    if (section.heading) {
      const h3 = document.createElement('h3');
      h3.textContent = section.heading;
      container.appendChild(h3);
    }
    for (const block of section.blocks) renderBlock(block, container);
  }
}

export function createAcademyController() {
  let container = null;
  let currentIndex = null; // null = 顯示目錄

  function renderToc() {
    container.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = '麻將學園';
    container.appendChild(title);
    container.appendChild(richP(overview, 'description'));

    const toc = document.createElement('div');
    toc.className = 'academy-toc';
    chapters.forEach((chapter, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'academy-toc-item';
      btn.textContent = chapter.title;
      btn.addEventListener('click', () => {
        currentIndex = i;
        render();
      });
      toc.appendChild(btn);
    });
    container.appendChild(toc);
  }

  function renderChapterView() {
    container.innerHTML = '';

    const nav = document.createElement('div');
    nav.className = 'academy-nav';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'no-wait-btn';
    backBtn.textContent = '← 回目錄';
    backBtn.addEventListener('click', () => {
      currentIndex = null;
      render();
    });
    nav.appendChild(backBtn);
    container.appendChild(nav);

    const article = document.createElement('div');
    article.className = 'academy-article';
    renderChapterContent(chapters[currentIndex], article);
    container.appendChild(article);

    const footNav = document.createElement('div');
    footNav.className = 'academy-nav academy-nav-footer';

    if (currentIndex > 0) {
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'no-wait-btn';
      prevBtn.textContent = '← 上一章';
      prevBtn.addEventListener('click', () => {
        currentIndex -= 1;
        render();
      });
      footNav.appendChild(prevBtn);
    }

    if (currentIndex < chapters.length - 1) {
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'submit-btn';
      nextBtn.textContent = '下一章 →';
      nextBtn.addEventListener('click', () => {
        currentIndex += 1;
        render();
      });
      footNav.appendChild(nextBtn);
    }

    container.appendChild(footNav);
  }

  function render() {
    if (!container) return;
    if (currentIndex === null) renderToc();
    else renderChapterView();
  }

  return {
    mount(el) {
      container = el;
      render();
    },
  };
}
