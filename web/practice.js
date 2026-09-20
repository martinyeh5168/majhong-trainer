// 隨機切牌練習:每輪隨機發 17 張,自己選一張打,系統告知是不是最佳解(向聽數+期望進張數)。
// 不是最佳解可以撤回重選,也可以堅持打下去繼續。

import { tileCode, tileFromCode, tileDisplayName, sortTiles } from '../src/tiles.js';
import { buildWall } from '../src/game.js';
import { analyzeDiscardsGeneral } from '../src/efficiency.js';
import { calculateShanten } from '../src/shanten.js';
import { checkWin } from '../src/winCheck.js';

const MAX_STARTING_SHANTEN = 3; // 隨機發的牌,最好的打法也要在 3 進聽以內,牌局才不會太離譜

function describeShanten(shanten) {
  if (shanten <= -1) return '已經胡牌';
  if (shanten === 0) return '聽牌中';
  return `向聽數 ${shanten}(還差 ${shanten} 步聽牌)`;
}

// 17 張牌裡挑一張打,最好的打法向聽數是多少(只算向聽數,不算進張,發牌階段用比較快)
function bestStartingShanten(hand) {
  let best = Infinity;
  for (let i = 0; i < hand.length; i++) {
    const remaining = [...hand.slice(0, i), ...hand.slice(i + 1)];
    const shanten = calculateShanten(remaining);
    if (shanten < best) best = shanten;
  }
  return best;
}

// 重新洗牌發 17 張,直到牌型不要太差(最佳打法在 3 進聽以內)為止
function dealPlayableHand() {
  for (let attempt = 0; attempt < 500; attempt++) {
    const freshWall = buildWall();
    const hand = freshWall.slice(0, 17);
    if (bestStartingShanten(hand) <= MAX_STARTING_SHANTEN) {
      return { wall: freshWall.slice(17), hand };
    }
  }
  // 理論上不會發生,保底还是回傳最後一次發的牌,不要卡住練習
  const freshWall = buildWall();
  return { wall: freshWall.slice(17), hand: freshWall.slice(0, 17) };
}

export function createPracticeController({ renderTileRow }) {
  let wall = [];
  let hand = [];
  let discards = [];
  let pendingCode = null;
  let lastResult = null; // { results, chosen, best, isOptimal }
  let stats = { correct: 0, total: 0 };
  let container = null;

  function newSession() {
    const dealt = dealPlayableHand();
    wall = dealt.wall;
    hand = dealt.hand;
    discards = [];
    pendingCode = null;
    lastResult = null;
    stats = { correct: 0, total: 0 };
  }

  function selectTile(code) {
    pendingCode = code;
    lastResult = null;
    render();
  }

  function confirmDiscard() {
    if (!pendingCode) return;
    const visibleTiles = [...hand, ...discards];
    const results = analyzeDiscardsGeneral(hand, [], visibleTiles);
    const chosen = results.find((r) => r.discard === pendingCode);
    const best = results[0];
    const isOptimal = chosen.shanten === best.shanten && chosen.ukeire === best.ukeire;
    lastResult = { results, chosen, best, isOptimal };
    render();
  }

  function undo() {
    pendingCode = null;
    lastResult = null;
    render();
  }

  function proceed() {
    const idx = hand.findIndex((t) => tileCode(t) === pendingCode);
    const [tile] = hand.splice(idx, 1);
    discards.push(tile);

    stats.total += 1;
    if (lastResult.isOptimal) stats.correct += 1;

    if (wall.length > 0) hand.push(wall.shift());

    pendingCode = null;
    lastResult = null;
    render();
  }

  function describeUseful(usefulTiles) {
    if (usefulTiles.length === 0) return '沒有能讓向聽數變好的牌了';
    return usefulTiles
      .map((u) => `${tileDisplayName(u.tile)}(剩${u.remaining}張)`)
      .join('、');
  }

  // AI 老師提示:打牌前先套用麻將學園的技巧講評目前盤勢,巡目 = 這一局已經摸過幾次牌
  // (只有自己一家在練習,沒有其他玩家可以讀牌/防守,所以只套用第一、二章跟牌效跟巡目相關的部分)。
  function currentTurn() {
    return discards.length + 1;
  }

  function currentPhase(turn) {
    if (turn <= 6) return '前盤';
    if (turn <= 11) return '中盤';
    return '後盤';
  }

  function buildTeacherAdvice() {
    const visibleTiles = [...hand, ...discards];
    const results = analyzeDiscardsGeneral(hand, [], visibleTiles);
    const best = results[0];
    const turn = currentTurn();
    const phase = currentPhase(turn);

    const lines = [];

    if (best.shanten <= -1) {
      lines.push('這手已經可以胡了,摸到就自摸,別想太多。');
    } else if (best.shanten === 0) {
      lines.push(
        `目前最好打法是打「${tileDisplayName(tileFromCode(best.discard))}」,打出去就聽 ${describeUseful(
          best.usefulTiles
        )}。`
      );
    } else {
      lines.push(
        `目前最好打法是打「${tileDisplayName(tileFromCode(best.discard))}」:${describeShanten(
          best.shanten
        )},期望進張 ${best.ukeire} 張。`
      );
    }

    if (phase === '前盤') {
      lines.push('第二章「巡目推進防禦標準」:前盤效率最大化,出牌路徑「字牌 → 么九孤張 → 偏張」,先拆用不到的孤張。');
    } else if (phase === '中盤') {
      lines.push('第二章「巡目推進防禦標準」:中盤是危險嗅探期,若還落後兩進聽以上又沒有大牌潛力,可以考慮停止衝效率。');
    } else if (best.shanten > 0) {
      lines.push('第二章「巡目推進防禦標準」:後盤(12巡後)還沒聽牌建議無條件下車,優先打自己棄過的牌,不要硬拚生張。');
    } else {
      lines.push('第二章「巡目推進防禦標準」:後盤已經聽牌了,可以放心進攻。');
    }

    return { turn, phase, lines };
  }

  function renderTeacherHint(container) {
    const advice = buildTeacherAdvice();
    const box = document.createElement('div');
    box.className = 'teacher-hint';

    const title = document.createElement('p');
    title.className = 'teacher-hint-title';
    title.textContent = '🀄 AI 老師';
    box.appendChild(title);

    for (const line of advice.lines) {
      const p = document.createElement('p');
      p.className = 'teacher-hint-line';
      p.textContent = line;
      box.appendChild(p);
    }

    container.appendChild(box);
  }

  function render() {
    if (!container) return;
    container.innerHTML = '';

    const rate = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    const headerRow = document.createElement('div');
    headerRow.className = 'practice-header-row';
    const header = document.createElement('p');
    header.className = 'hint';
    header.textContent = `這回合共答對 ${stats.correct} / ${stats.total} 次(正確率 ${rate}%)・牌牆剩 ${wall.length} 張・發牌會限制在 3 進聽以內`;
    const turnBadge = document.createElement('span');
    turnBadge.className = 'practice-turn-badge';
    turnBadge.textContent = `第 ${currentTurn()} 巡`;
    headerRow.appendChild(header);
    headerRow.appendChild(turnBadge);
    container.appendChild(headerRow);

    if (hand.length < 17) {
      const doneP = document.createElement('p');
      doneP.className = 'description';
      doneP.textContent = '牌摸完了,這回合練習結束。';
      container.appendChild(doneP);
      const restartRow = document.createElement('div');
      restartRow.className = 'practice-action-row';
      const restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.className = 'submit-btn';
      restartBtn.textContent = '開始新的一輪';
      restartBtn.addEventListener('click', () => {
        newSession();
        render();
      });
      restartRow.appendChild(restartBtn);
      container.appendChild(restartRow);
      return;
    }

    // 摸到的 17 張剛好胡牌(自摸),不用再選打哪張了,直接恭喜
    if (checkWin({ concealedTiles: hand }).win) {
      container.appendChild(renderTileRow(sortTiles(hand)));

      const winP = document.createElement('p');
      winP.className = 'verdict correct';
      winP.textContent = '🎉 恭喜胡牌!';
      container.appendChild(winP);

      const actionRow = document.createElement('div');
      actionRow.className = 'practice-action-row';
      const restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.className = 'submit-btn';
      restartBtn.textContent = '開始新的一輪';
      restartBtn.addEventListener('click', () => {
        newSession();
        render();
      });
      actionRow.appendChild(restartBtn);
      container.appendChild(actionRow);
      return;
    }

    if (!lastResult) renderTeacherHint(container);

    container.appendChild(
      renderTileRow(sortTiles(hand), {
        onClick: lastResult ? undefined : (code) => selectTile(code),
        selectedCode: pendingCode,
      })
    );

    const confirmRow = document.createElement('div');
    confirmRow.className = 'practice-action-row';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'submit-btn';
    confirmBtn.textContent = '確認要打的牌';
    confirmBtn.disabled = !pendingCode || !!lastResult;
    confirmBtn.addEventListener('click', confirmDiscard);
    confirmRow.appendChild(confirmBtn);
    container.appendChild(confirmRow);

    if (!lastResult) return;

    const feedback = document.createElement('div');
    feedback.className = 'feedback';

    const verdict = document.createElement('p');
    verdict.className = lastResult.isOptimal ? 'verdict correct' : 'verdict wrong';
    verdict.textContent = lastResult.isOptimal ? '✓ 這是最佳解!' : '✗ 還有更好的打法';
    feedback.appendChild(verdict);

    const chosenP = document.createElement('p');
    chosenP.textContent = `你打「${tileDisplayName(tileFromCode(lastResult.chosen.discard))}」:${describeShanten(
      lastResult.chosen.shanten
    )},期望進張 ${lastResult.chosen.ukeire} 張 —— ${describeUseful(lastResult.chosen.usefulTiles)}`;
    feedback.appendChild(chosenP);

    if (!lastResult.isOptimal) {
      const bestP = document.createElement('p');
      bestP.textContent = `最佳解是打「${tileDisplayName(tileFromCode(lastResult.best.discard))}」:${describeShanten(
        lastResult.best.shanten
      )},期望進張 ${lastResult.best.ukeire} 張 —— ${describeUseful(lastResult.best.usefulTiles)}`;
      feedback.appendChild(bestP);
    }

    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '看每一種打法的完整分析';
    detail.appendChild(summary);
    const list = document.createElement('ul');
    for (const r of lastResult.results) {
      const li = document.createElement('li');
      li.textContent = `打「${tileDisplayName(tileFromCode(r.discard))}」:${describeShanten(r.shanten)},期望進張 ${r.ukeire} 張`;
      list.appendChild(li);
    }
    detail.appendChild(list);
    feedback.appendChild(detail);

    container.appendChild(feedback);

    const btnRow = document.createElement('div');
    btnRow.className = 'practice-action-row';
    if (lastResult.isOptimal) {
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'submit-btn';
      nextBtn.textContent = '抽下一張,繼續';
      nextBtn.addEventListener('click', proceed);
      btnRow.appendChild(nextBtn);
    } else {
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'no-wait-btn';
      undoBtn.textContent = '撤回,重新選';
      undoBtn.addEventListener('click', undo);
      btnRow.appendChild(undoBtn);

      const proceedBtn = document.createElement('button');
      proceedBtn.type = 'button';
      proceedBtn.className = 'submit-btn';
      proceedBtn.textContent = '還是要打這張,繼續';
      proceedBtn.addEventListener('click', proceed);
      btnRow.appendChild(proceedBtn);
    }
    container.appendChild(btnRow);
  }

  return {
    mount(el) {
      container = el;
      if (hand.length === 0) newSession();
      render();
    },
  };
}
