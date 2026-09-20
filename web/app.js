import { parseHand, formatHand } from '../src/handNotation.js';
import { allTileTypes, tileCode, tileFromCode, tileDisplayName } from '../src/tiles.js';
import { getWaits } from '../src/tingCheck.js';
import { computeScore } from '../src/scoring.js';
import { analyzeDiscards } from '../src/efficiency.js';
import { efficiencyQuestions, waitQuestions, scoringQuestions, safetyQuestions } from './questions.js';
import { createPlayController } from './play.js';
import { createPracticeController } from './practice.js';
import { createMatchController } from './match.js';
import { createAcademyController } from './academy.js';
import { tileImageSrc } from './tileAssets.js';

const ALL_QUESTIONS = [...efficiencyQuestions, ...waitQuestions, ...scoringQuestions, ...safetyQuestions];

function parseMelds(rawMelds) {
  if (!rawMelds) return [];
  return rawMelds.map((m) => ({ type: m.type, tiles: parseHand(m.tiles) }));
}

function findQuestionById(id) {
  return ALL_QUESTIONS.find((q) => q.id === id);
}

// 重點複習用:隨機把萬/筒/條三種花色互換(字牌不動),讓同一種題型換一套牌面,
// 不會跟原題長得一模一樣,但胡牌型態/聽牌型態/切牌效率的答案完全不變。
function randomSuitMapping() {
  const suits = ['m', 'p', 's'];
  let shuffled;
  do {
    shuffled = [...suits];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  } while (shuffled.every((s, i) => s === suits[i])); // 重抽到跟原本一樣就再抽一次
  return Object.fromEntries(suits.map((s, i) => [s, shuffled[i]]));
}

function permuteTile(tile, mapping) {
  return tile.suit === 'z' ? tile : { suit: mapping[tile.suit], rank: tile.rank };
}

function permuteHandNotation(notation, mapping) {
  return formatHand(parseHand(notation).map((t) => permuteTile(t, mapping)));
}

function makeReviewVariant(q) {
  const mapping = randomSuitMapping();
  const variant = { ...q, hand: permuteHandNotation(q.hand, mapping) };
  if (q.melds) {
    variant.melds = q.melds.map((m) => ({ type: m.type, tiles: permuteHandNotation(m.tiles, mapping) }));
  }
  if (q.winningTile) {
    variant.winningTile = tileCode(permuteTile(tileFromCode(q.winningTile), mapping));
  }
  if (q.opponentHand) {
    variant.opponentHand = permuteHandNotation(q.opponentHand, mapping);
  }
  return variant;
}

const STORAGE_KEY = 'majhong-trainer-progress-v1';
const STORAGE_KEY_V2 = 'majhong-trainer-progress-v2';

const KIND_NAME = { efficiency: '切牌測驗', wait: '聽牌測驗', scoring: '台數測驗', safety: '防守測驗' };

function emptyStats() {
  return { overall: { correct: 0, total: 0 }, byKind: {}, byTag: {}, reviewQueue: {} };
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.reviewQueue) parsed.reviewQueue = {};
      return parsed;
    }
  } catch {
    /* 讀不到就當作全新開始 */
  }
  // 舊版只有總數,沒有分類細節。搬過來當作起始總數,細項就從頭累積。
  try {
    const old = localStorage.getItem(STORAGE_KEY);
    if (old) {
      const parsed = JSON.parse(old);
      const stats = emptyStats();
      stats.overall = { correct: parsed.correct ?? 0, total: parsed.total ?? 0 };
      return stats;
    }
  } catch {
    /* 忽略 */
  }
  return emptyStats();
}

function saveStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(stats));
  } catch {
    /* 私密瀏覽模式等情況下存不進去就算了,不影響作答 */
  }
}

const state = {
  filter: 'all',
  index: 0,
  stats: loadStats(),
  reviewList: [],
};

const els = {
  appHeader: document.getElementById('app-header'),
  homeBtn: document.getElementById('home-btn'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  progress: document.getElementById('progress'),
  scoreboard: document.getElementById('scoreboard'),
  card: document.getElementById('question-card'),
  nextBtn: document.getElementById('next-btn'),
};

// 人機對局/麻將實戰進行中的時候,標題/分類頁籤/計分板先隱藏,騰出畫面空間,結束才顯示回來
let playGameActive = false;
let matchGameActive = false;
function updateHeaderVisibility() {
  els.appHeader.hidden =
    (state.filter === 'play' && playGameActive) || (state.filter === 'match' && matchGameActive);
}

function currentList() {
  if (state.filter === 'efficiency') return efficiencyQuestions;
  if (state.filter === 'wait') return waitQuestions;
  if (state.filter === 'scoring') return scoringQuestions;
  if (state.filter === 'safety') return safetyQuestions;
  if (state.filter === 'review') return state.reviewList;
  return ALL_QUESTIONS;
}

function buildReviewList() {
  state.reviewList = Object.keys(state.stats.reviewQueue)
    .map(findQuestionById)
    .filter(Boolean)
    .map(makeReviewVariant);
}

function tileImg(tile) {
  const img = document.createElement('img');
  img.src = tileImageSrc(tile);
  img.alt = tileDisplayName(tile);
  img.draggable = false;
  return img;
}

function renderTileRow(tiles, { onClick, onDoubleClick, selectedCode, small } = {}) {
  const row = document.createElement('div');
  row.className = small ? 'tile-row tile-row-small' : 'tile-row';
  for (const tile of tiles) {
    const code = tileCode(tile);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = small ? 'tile tile-small' : 'tile';
    if (selectedCode && code === selectedCode) btn.classList.add('tile-selected');
    btn.appendChild(tileImg(tile));
    btn.disabled = !onClick;
    if (onClick) btn.addEventListener('click', () => onClick(code, tile));
    if (onDoubleClick) btn.addEventListener('dblclick', () => onDoubleClick(code, tile));
    row.appendChild(btn);
  }
  return row;
}

function renderTilePicker(selectedCodes, onToggle) {
  const wrap = document.createElement('div');
  wrap.className = 'tile-picker';
  for (const tile of allTileTypes()) {
    const code = tileCode(tile);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile tile-small';
    if (selectedCodes.has(code)) btn.classList.add('tile-selected');
    btn.appendChild(tileImg(tile));
    btn.addEventListener('click', () => onToggle(code));
    wrap.appendChild(btn);
  }
  return wrap;
}

function bump(bucket, isCorrect) {
  bucket.total += 1;
  if (isCorrect) bucket.correct += 1;
}

/**
 * kind: 'efficiency' | 'wait' | 'scoring'
 * tags: [{ key, label }] —— 這一題牽涉到的弱點分析分類,答對答錯都會分別記到這些分類底下
 * questionId: 原始題目 id(重點複習模式下答的是變體,但仍然算在原題底下)
 */
function recordAnswer(isCorrect, kind, tags = [], questionId = null) {
  bump(state.stats.overall, isCorrect);

  if (!state.stats.byKind[kind]) state.stats.byKind[kind] = { correct: 0, total: 0 };
  bump(state.stats.byKind[kind], isCorrect);

  for (const tag of tags) {
    if (!state.stats.byTag[tag.key]) {
      state.stats.byTag[tag.key] = { label: tag.label, correct: 0, total: 0 };
    }
    bump(state.stats.byTag[tag.key], isCorrect);
  }

  if (questionId) {
    if (isCorrect) delete state.stats.reviewQueue[questionId];
    else state.stats.reviewQueue[questionId] = true;
  }

  saveStats(state.stats);
  renderScoreboard();
}

function renderScoreboard() {
  const { correct, total } = state.stats.overall;
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0;
  els.scoreboard.textContent = `累計答對 ${correct} / ${total} 題(正確率 ${rate}%)`;
}

function renderProgress() {
  const list = currentList();
  els.progress.textContent = `第 ${state.index + 1} / ${list.length} 題`;
}

function renderEfficiencyQuestion(q, container) {
  const hand = parseHand(q.hand);
  let chosen = null;

  const handRow = document.createElement('div');
  handRow.className = 'tile-row';

  const feedback = document.createElement('div');
  feedback.className = 'feedback';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'submit-btn';
  submitBtn.textContent = '確認要打的牌';

  function renderBody() {
    const freshRow = renderTileRow(hand, {
      onClick: (code) => {
        chosen = code;
        renderBody();
      },
      selectedCode: chosen,
    });
    handRow.replaceChildren(...freshRow.children);
    submitBtn.disabled = !chosen;
  }
  renderBody();

  submitBtn.addEventListener('click', () => {
    if (!chosen) return;
    const results = analyzeDiscards(hand, [], hand);
    const bestUkeire = results[0].ukeire;
    const mine = results.find((r) => r.discard === chosen);
    const isCorrect = mine.ukeire === bestUkeire;

    const describe = (r) => {
      if (!r.isTenpai) return `打 ${tileDisplayName(tileFromCode(r.discard))}:沒有聽牌`;
      const waitNames = r.waits.map((w) => `${tileDisplayName(w.tile)}(剩${w.remaining}張)`).join('、');
      return `打 ${tileDisplayName(tileFromCode(r.discard))}:聽 ${waitNames},共 ${r.ukeire} 張進張`;
    };

    feedback.innerHTML = '';
    const verdict = document.createElement('p');
    verdict.className = isCorrect ? 'verdict correct' : 'verdict wrong';
    verdict.textContent = isCorrect ? '✓ 這是最佳解!' : '✗ 還有更好的打法';
    feedback.appendChild(verdict);

    const mineP = document.createElement('p');
    mineP.textContent = `你的選擇 —— ${describe(mine)}`;
    feedback.appendChild(mineP);

    if (!isCorrect) {
      const bestP = document.createElement('p');
      bestP.textContent = `最佳解 —— ${describe(results[0])}`;
      feedback.appendChild(bestP);
    }

    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '看每一種打法的完整分析';
    detail.appendChild(summary);
    const list = document.createElement('ul');
    for (const r of results) {
      const li = document.createElement('li');
      li.textContent = describe(r);
      list.appendChild(li);
    }
    detail.appendChild(list);
    feedback.appendChild(detail);

    const tenpaiOptions = results.filter((r) => r.isTenpai).length;
    const tradeoff = tenpaiOptions > 1;
    recordAnswer(
      isCorrect,
      'efficiency',
      [
        {
          key: `efficiency:${tradeoff ? 'tradeoff' : 'obvious'}`,
          label: tradeoff ? '有取捨(不只一種打法能聽牌)' : '打法明確(只有一種能聽牌)',
        },
      ],
      q.id
    );
    submitBtn.disabled = true;
    els.nextBtn.hidden = false;
  });

  container.appendChild(handRow);
  container.appendChild(submitBtn);
  container.appendChild(feedback);
}

function renderWaitQuestion(q, container) {
  const hand = parseHand(q.hand);
  const selected = new Set();
  let noWait = false;

  container.appendChild(renderTileRow(hand));

  const label = document.createElement('p');
  label.className = 'hint';
  label.textContent = '在下面選出你認為能胡的牌(可以選多張),如果你認為這手牌根本沒聽,按「沒有聽牌」:';
  container.appendChild(label);

  const noWaitBtn = document.createElement('button');
  noWaitBtn.type = 'button';
  noWaitBtn.className = 'no-wait-btn';
  noWaitBtn.textContent = '這手牌沒有聽牌';

  const pickerHolder = document.createElement('div');
  const feedback = document.createElement('div');
  feedback.className = 'feedback';

  function renderPicker() {
    noWaitBtn.classList.toggle('tile-selected', noWait);
    pickerHolder.replaceChildren(
      renderTilePicker(selected, (code) => {
        noWait = false;
        if (selected.has(code)) selected.delete(code);
        else selected.add(code);
        renderPicker();
      })
    );
  }

  noWaitBtn.addEventListener('click', () => {
    noWait = !noWait;
    if (noWait) selected.clear();
    renderPicker();
  });

  renderPicker();

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'submit-btn';
  submitBtn.textContent = '送出答案';

  submitBtn.addEventListener('click', () => {
    const actualWaits = getWaits({ concealedTiles: hand });
    const actualCodes = new Set(actualWaits.map((w) => w.code));
    const isCorrect =
      actualCodes.size === selected.size && [...actualCodes].every((c) => selected.has(c));

    feedback.innerHTML = '';
    const verdict = document.createElement('p');
    verdict.className = isCorrect ? 'verdict correct' : 'verdict wrong';
    if (actualCodes.size === 0) {
      verdict.textContent = isCorrect ? '✓ 答對了,這手牌根本沒聽!' : '✗ 這手牌其實沒有聽牌';
    } else {
      const names = [...actualCodes].map((c) => tileDisplayName(tileFromCode(c))).join('、');
      verdict.textContent = isCorrect ? `✓ 答對了!聽:${names}` : `✗ 正確答案是聽:${names}`;
    }
    feedback.appendChild(verdict);

    const bucket = actualCodes.size === 0 ? 'none' : actualCodes.size === 1 ? 'narrow' : 'wide';
    const bucketLabel =
      bucket === 'none' ? '沒有聽牌' : bucket === 'narrow' ? '單一聽牌(邊張/坎張/單吊)' : '多張聽牌(兩面/雙碰等)';
    recordAnswer(isCorrect, 'wait', [{ key: `wait:${bucket}`, label: bucketLabel }], q.id);
    submitBtn.disabled = true;
    els.nextBtn.hidden = false;
  });

  container.appendChild(noWaitBtn);
  container.appendChild(pickerHolder);
  container.appendChild(submitBtn);
  container.appendChild(feedback);
}

function renderScoringQuestion(q, container) {
  const hand = parseHand(q.hand);
  const melds = parseMelds(q.melds);
  const winningTile = tileFromCode(q.winningTile);

  container.appendChild(renderTileRow(hand));

  if (melds.length > 0) {
    const meldsLabel = document.createElement('p');
    meldsLabel.className = 'hint';
    meldsLabel.textContent = '已經吃碰的面子:';
    container.appendChild(meldsLabel);
    for (const meld of melds) {
      container.appendChild(renderTileRow(meld.tiles));
    }
  }

  const winLabel = document.createElement('p');
  winLabel.className = 'hint';
  winLabel.textContent = `胡的那張牌:${tileDisplayName(winningTile)}(${
    q.context.selfDrawn ? '自摸' : '別人打的牌(點炮)'
  }${q.context.isFirstTurn ? '・第一輪' : ''}${q.context.isDealer ? '・莊家' : ''})`;
  container.appendChild(winLabel);

  const inputWrap = document.createElement('div');
  inputWrap.className = 'answer-input';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.placeholder = '猜猜總共幾台';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'submit-btn';
  submitBtn.textContent = '送出答案';
  inputWrap.appendChild(input);
  inputWrap.appendChild(submitBtn);

  const feedback = document.createElement('div');
  feedback.className = 'feedback';

  submitBtn.addEventListener('click', () => {
    const guess = Number(input.value);
    const score = computeScore({ concealedTiles: hand, melds }, winningTile, q.context);
    const isCorrect = guess === score.total;

    feedback.innerHTML = '';
    const verdict = document.createElement('p');
    verdict.className = isCorrect ? 'verdict correct' : 'verdict wrong';
    verdict.textContent = isCorrect
      ? `✓ 答對了!總共 ${score.total} 台`
      : `✗ 正確答案是 ${score.total} 台(你猜 ${guess || 0} 台)`;
    feedback.appendChild(verdict);

    const list = document.createElement('ul');
    for (const item of score.items) {
      const li = document.createElement('li');
      li.textContent = `${item.name}:${item.tai} 台`;
      list.appendChild(li);
    }
    feedback.appendChild(list);

    const tags = score.items
      .filter((it) => it.key !== 'base')
      .map((it) => ({ key: `score:${it.key}`, label: it.name }));
    recordAnswer(isCorrect, 'scoring', tags, q.id);
    input.disabled = true;
    submitBtn.disabled = true;
    els.nextBtn.hidden = false;
  });

  container.appendChild(inputWrap);
  container.appendChild(feedback);
}

function renderSafetyQuestion(q, container) {
  const hand = parseHand(q.hand);
  const opponentHand = parseHand(q.opponentHand);
  let chosen = null;

  const oppLabel = document.createElement('p');
  oppLabel.className = 'hint';
  oppLabel.textContent = '對手已經聽牌,經過判斷確定他的手牌是這 16 張(訓練用才看得到,實戰看不到對手手牌):';
  container.appendChild(oppLabel);
  container.appendChild(renderTileRow(opponentHand, { small: true }));

  const myLabel = document.createElement('p');
  myLabel.className = 'hint';
  myLabel.textContent = '這是你摸牌後的 17 張手牌,點一張你要打出去的安全牌:';
  container.appendChild(myLabel);

  const handRow = document.createElement('div');
  handRow.className = 'tile-row';

  const feedback = document.createElement('div');
  feedback.className = 'feedback';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'submit-btn';
  submitBtn.textContent = '確認要打的牌';

  function renderBody() {
    const freshRow = renderTileRow(hand, {
      onClick: (code) => {
        chosen = code;
        renderBody();
      },
      selectedCode: chosen,
    });
    handRow.replaceChildren(...freshRow.children);
    submitBtn.disabled = !chosen;
  }
  renderBody();

  submitBtn.addEventListener('click', () => {
    if (!chosen) return;
    const waits = getWaits({ concealedTiles: opponentHand });
    const waitCodes = new Set(waits.map((w) => w.code));
    const isCorrect = !waitCodes.has(chosen);
    const waitNames = waits.map((w) => tileDisplayName(w.tile)).join('、') || '(沒聽,不可能發生)';

    feedback.innerHTML = '';
    const verdict = document.createElement('p');
    verdict.className = isCorrect ? 'verdict correct' : 'verdict wrong';
    if (isCorrect) {
      verdict.textContent = `✓ 安全!對手聽 ${waitNames},這張不在裡面。`;
    } else {
      const chosenTile = tileFromCode(chosen);
      const score = computeScore({ concealedTiles: opponentHand }, chosenTile, { selfDrawn: false });
      verdict.textContent = `✗ 放槍了!對手聽 ${waitNames},剛好被你打出去,賠了 ${score.total} 台。`;
    }
    feedback.appendChild(verdict);

    const bucket = waits.length <= 1 ? 'narrow' : 'wide';
    recordAnswer(
      isCorrect,
      'safety',
      [{ key: `safety:${bucket}`, label: bucket === 'narrow' ? '對手單吊/單聽' : '對手多面聽牌' }],
      q.id
    );
    submitBtn.disabled = true;
    els.nextBtn.hidden = false;
  });

  container.appendChild(handRow);
  container.appendChild(submitBtn);
  container.appendChild(feedback);
}

const KIND_INFO = {
  efficiency: {
    heading: '該打哪張?',
    instruction: '摸牌後手上有 17 張,點一張你要打出去的牌。',
  },
  wait: {
    heading: '這手牌聽什麼?',
    instruction: '16 張牌,自己判斷聽哪幾張(可以都不選,如果你認為沒聽)。',
  },
  scoring: {
    heading: '這手牌算幾台?',
    instruction: '算出總台數,填數字送出。',
  },
  safety: {
    heading: '打哪張才安全?',
    instruction: '對手已經聽牌(訓練用直接顯示他的手牌),從你的 17 張裡挑一張保證不會放槍的牌。',
  },
};

function rate(bucket) {
  return bucket.total > 0 ? Math.round((bucket.correct / bucket.total) * 100) : null;
}

function renderAnalysis(container) {
  els.progress.textContent = '';

  const title = document.createElement('h2');
  title.textContent = '弱點分析';
  container.appendChild(title);

  const { overall, byKind, byTag } = state.stats;

  if (overall.total === 0) {
    const empty = document.createElement('p');
    empty.className = 'description';
    empty.textContent = '還沒有作答紀錄,先去答幾題吧。';
    container.appendChild(empty);
    return;
  }

  const desc = document.createElement('p');
  desc.className = 'description';
  desc.textContent = `目前累計 ${overall.total} 題,總正確率 ${rate(overall)}%。以下依分類統計,幫你找出比較弱的地方。`;
  container.appendChild(desc);

  const kindHeading = document.createElement('h3');
  kindHeading.textContent = '依題型分類';
  container.appendChild(kindHeading);
  const kindList = document.createElement('ul');
  for (const kind of ['efficiency', 'wait', 'scoring', 'safety']) {
    const bucket = byKind[kind];
    const li = document.createElement('li');
    li.textContent = bucket
      ? `${KIND_NAME[kind]}:${bucket.correct} / ${bucket.total} 題(正確率 ${rate(bucket)}%)`
      : `${KIND_NAME[kind]}:還沒作答`;
    kindList.appendChild(li);
  }
  container.appendChild(kindList);

  const tagEntries = Object.entries(byTag)
    .map(([key, bucket]) => ({ key, ...bucket, rate: rate(bucket) }))
    .sort((a, b) => a.rate - b.rate || b.total - a.total);

  if (tagEntries.length > 0) {
    const tagHeading = document.createElement('h3');
    tagHeading.textContent = '依細項分類(由弱到強)';
    container.appendChild(tagHeading);
    const tagList = document.createElement('ul');
    for (const t of tagEntries) {
      const li = document.createElement('li');
      li.textContent = `${t.label}:${t.correct} / ${t.total} 題(正確率 ${t.rate}%)`;
      if (t.total >= 2 && t.rate < 70) li.classList.add('weak-tag');
      tagList.appendChild(li);
    }
    container.appendChild(tagList);

    const weakest = tagEntries.filter((t) => t.total >= 2 && t.rate < 70).slice(0, 3);
    if (weakest.length > 0) {
      const suggestion = document.createElement('p');
      suggestion.className = 'hint';
      suggestion.textContent = `建議加強:${weakest.map((t) => t.label).join('、')}`;
      container.appendChild(suggestion);
    }
  }

  const reviewCount = Object.keys(state.stats.reviewQueue).length;
  const reviewP = document.createElement('p');
  reviewP.className = 'hint';
  reviewP.textContent =
    reviewCount > 0
      ? `目前有 ${reviewCount} 題答錯還沒訂正。`
      : '目前沒有答錯還沒訂正的題目。';
  container.appendChild(reviewP);

  if (reviewCount > 0) {
    const reviewBtn = document.createElement('button');
    reviewBtn.type = 'button';
    reviewBtn.className = 'submit-btn';
    reviewBtn.textContent = '開始重點複習';
    reviewBtn.addEventListener('click', () => switchFilter('review'));
    container.appendChild(reviewBtn);
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'no-wait-btn';
  resetBtn.textContent = '清除所有作答紀錄';
  resetBtn.addEventListener('click', () => {
    state.stats = emptyStats();
    saveStats(state.stats);
    renderScoreboard();
    renderQuestion();
  });
  container.appendChild(resetBtn);
}

function renderQuestion() {
  if (state.filter === 'analysis') {
    els.card.innerHTML = '';
    els.nextBtn.hidden = true;
    renderAnalysis(els.card);
    return;
  }

  if (state.filter === 'play') {
    els.progress.textContent = '';
    els.nextBtn.hidden = true;
    playController.mount(els.card);
    return;
  }

  if (state.filter === 'practice') {
    els.progress.textContent = '';
    els.nextBtn.hidden = true;
    practiceController.mount(els.card);
    return;
  }

  if (state.filter === 'match') {
    els.progress.textContent = '';
    els.nextBtn.hidden = true;
    matchController.mount(els.card);
    return;
  }

  if (state.filter === 'academy') {
    els.progress.textContent = '';
    els.nextBtn.hidden = true;
    academyController.mount(els.card);
    return;
  }

  const list = currentList();

  els.card.innerHTML = '';
  els.nextBtn.hidden = true;

  if (list.length === 0) {
    if (state.filter === 'review') {
      const title = document.createElement('h2');
      title.textContent = '重點複習';
      const desc = document.createElement('p');
      desc.className = 'description';
      desc.textContent = '目前沒有需要重點複習的題目 —— 答錯的題目才會出現在這裡,繼續保持!';
      els.card.appendChild(title);
      els.card.appendChild(desc);
      els.progress.textContent = '';
    }
    return;
  }

  state.index = ((state.index % list.length) + list.length) % list.length;
  const q = list[state.index];
  const info = KIND_INFO[q.kind];

  const title = document.createElement('h2');
  title.textContent = info.heading;
  const desc = document.createElement('p');
  desc.className = 'description';
  desc.textContent =
    state.filter === 'review'
      ? `${info.instruction}(重點複習:同類型換了一套牌,不是原題)`
      : info.instruction;
  els.card.appendChild(title);
  els.card.appendChild(desc);

  if (q.kind === 'efficiency') renderEfficiencyQuestion(q, els.card);
  else if (q.kind === 'wait') renderWaitQuestion(q, els.card);
  else if (q.kind === 'scoring') renderScoringQuestion(q, els.card);
  else if (q.kind === 'safety') renderSafetyQuestion(q, els.card);

  renderProgress();
}

const playController = createPlayController({
  renderTileRow,
  onActiveChange: (isActive) => {
    playGameActive = isActive;
    updateHeaderVisibility();
  },
});
const practiceController = createPracticeController({ renderTileRow });
const academyController = createAcademyController();
const matchController = createMatchController({
  renderTileRow,
  onActiveChange: (isActive) => {
    matchGameActive = isActive;
    updateHeaderVisibility();
  },
});

function switchFilter(filterName) {
  state.filter = filterName;
  state.index = 0;
  if (filterName === 'review') buildReviewList();
  els.filterButtons.forEach((b) => b.classList.toggle('active', b.dataset.filter === filterName));
  updateHeaderVisibility();
  renderQuestion();
}

els.filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchFilter(btn.dataset.filter));
});

// 固定顯示在畫面角落,不放在 app-header 裡面 —— 人機對局進行中 app-header 會整個隱藏,
// 這顆按鈕才是唯一能不用打完/重整頁面就離開對局回首頁的方法。
els.homeBtn.addEventListener('click', () => switchFilter('all'));

els.nextBtn.addEventListener('click', () => {
  state.index += 1;
  renderQuestion();
});

renderScoreboard();
renderQuestion();
