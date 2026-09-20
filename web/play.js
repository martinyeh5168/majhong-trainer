// 完整對局練習(v1.3):你 + 3 個 AI,摸牌/打牌/吃碰槓/點炮胡牌/搶槓。
// AI 目前沒有防守概念,不會判斷牌危不危險,所以點炮(放槍)機率偏高,這是已知的簡化。
// AI 對暗槓/加槓一律貪心宣告(能槓就槓,不考慮藏牌價值),對明槓則沿用一般吃碰的
// 向聽數判斷邏輯(通常不會發生,因為手上已經 3 張的組本來就已經算完成的面子了)。

import { tileCode, tileFromCode, tileDisplayName, sortTiles } from '../src/tiles.js';
import {
  createGame,
  drawForCurrentPlayer,
  chooseAiDiscard,
  chooseAiDiscardWithReason,
  discard,
  declareTsumo,
  computeCallOpportunities,
  chooseAiCallDecision,
  applyPon,
  applyChi,
  skipCall,
  findRonOpportunity,
  applyRon,
  findAnkanOptions,
  applyAnkan,
  findKakanOptions,
  beginKakan,
  findChankanOpportunity,
  applyChankan,
  finalizeKakan,
  applyMinkan,
  markFuriten,
  tenpaiWaitCodesFor,
} from '../src/game.js';
import { analyzeDiscardsGeneral } from '../src/efficiency.js';
import { calculateShanten } from '../src/shanten.js';

const SEAT_NAME = ['你(莊家)', 'AI 下家', 'AI 對面', 'AI 上家'];
const SEAT_SHORT_NAME = ['你', 'AI 下家', 'AI 對面', 'AI 上家'];
const SEAT_WIND = ['東', '南', '西', '北']; // 莊家(座位0)固定坐東,其餘依序南西北
const POSITION_LABEL = ['', '下家', '對面', '上家']; // 座位0(自己)用不到,只給另外三家標示相對位置
const MELD_LABEL = { pon: '碰', chi: '吃', ankan: '暗槓', minkan: '槓' };
const AI_DISCARD_PAUSE_MS = 2000; // AI 出牌後,沒人需要決定的話,讓那張牌閃爍 2 秒再換下一家

// 3 個 AI 對手的固定人設(照片+名字),每開一局就重新洗牌決定誰坐哪一家
const AI_PROFILES = [
  { name: '西富', avatar: 'web/avatars/ma-ge.jpg' },
  { name: '涂董', avatar: 'web/avatars/tu-dong.jpg' },
  { name: '大亨', avatar: 'web/avatars/da-heng.jpg' },
];

function shuffled(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function describeShanten(shanten) {
  if (shanten <= -1) return '已經胡牌';
  if (shanten === 0) return '聽牌中';
  return `向聽數 ${shanten}(還差 ${shanten} 步聽牌)`;
}

function describeUseful(usefulTiles) {
  if (usefulTiles.length === 0) return '沒有能讓向聽數變好的牌了';
  return usefulTiles.map((u) => `${tileDisplayName(u.tile)}(剩${u.remaining}張)`).join('、');
}

// 這張牌屬於孤張拆牌順序(字牌 > 么九 > 2、8 > 中間張)裡的哪一類,純粹給老師的說明文字用
function describeIsolationKind(tile) {
  if (tile.suit === 'z') return '字牌';
  if (tile.rank === 1 || tile.rank === 9) return '么九';
  if (tile.rank === 2 || tile.rank === 8) return '2、8';
  return '中間張';
}

function describeCallOption(option) {
  if (option.type === 'pon') return '碰';
  if (option.type === 'kan') return '槓';
  return `吃(${option.otherRanks.slice().sort((a, b) => a - b).join('、')})`;
}

export function createPlayController({ renderTileRow, onActiveChange }) {
  let game = null;
  let container = null;
  let pendingDrewCode = null; // 剛摸到的牌(含槓後補牌),顯示時特別標出來
  let pendingCanWin = false; // 這次摸牌後,是不是可以宣告自摸
  let pendingIsRinshan = false; // 目前這個自摸機會是不是槓上開花(補牌摸到的)
  let pendingCallPrompt = null; // 別人打牌後,輪到玩家決定要不要吃碰槓
  let pendingRonPrompt = null; // 別人打牌剛好完成玩家的胡牌,等玩家決定要不要胡
  let pendingChankanPrompt = null; // 別人正在加槓,等玩家決定要不要搶槓
  let pendingDiscardChoice = null; // 點了但還沒按確認的打牌候選
  let pendingDiscardPreview = null; // 確認後算出來的分析結果,決定要撤回重選還是繼續打出去
  let pendingPassPreview = null; // 按了「略過」後算出來的分析結果(略過是不是最佳解),決定要撤回重選還是真的略過
  let lastDiscard = null; // { seat, code } —— 最近一次 AI 打出的牌,顯示時會閃爍;等真人決定/2 秒後才會換下一家
  let seatIdentity = [null, null, null, null]; // 座位0(自己)用不到;另外三家這一局分別是誰(名字+照片)

  // 座位 1~3 給人看的標籤:「名字(相對位置)」,例如「馬哥(上家)」
  function seatLabel(seat) {
    if (seat === 0) return SEAT_NAME[0];
    const identity = seatIdentity[seat];
    return identity ? `${identity.name}(${POSITION_LABEL[seat]})` : SEAT_NAME[seat];
  }

  // 這一手贏牌(自摸或胡別人放槍)的座位,還沒結束或是流局就回傳 null
  function winningSeat() {
    if (!game.finished) return null;
    if (game.result.type === 'tsumo') return game.result.seat;
    if (game.result.type === 'ron') return game.result.winnerSeat;
    return null;
  }

  // 贏家座位上顯眼的「胡牌!」標記,用在對手座位卡片跟自己的手牌區
  function buildWinBadge() {
    const badge = document.createElement('div');
    badge.className = 'win-badge';
    badge.textContent = '胡牌!';
    return badge;
  }

  function newGame() {
    game = createGame([
      { id: 'you', isHuman: true },
      { id: 'ai1', isHuman: false },
      { id: 'ai2', isHuman: false },
      { id: 'ai3', isHuman: false },
    ]);
    const shuffledProfiles = shuffled(AI_PROFILES);
    seatIdentity = [null, shuffledProfiles[0], shuffledProfiles[1], shuffledProfiles[2]];
    pendingDrewCode = null;
    pendingCanWin = false;
    pendingIsRinshan = false;
    pendingCallPrompt = null;
    pendingRonPrompt = null;
    pendingChankanPrompt = null;
    pendingDiscardChoice = null;
    pendingDiscardPreview = null;
    pendingPassPreview = null;
    lastDiscard = null;
    advanceUntilHumanOrEnd();
  }

  // 場上看得到的牌:自己手牌 + 所有人的棄牌跟已經吃碰的面子(別人手裡蓋著的牌看不到,不算)
  function visibleTilesFor(you) {
    return [
      ...you.hand,
      ...game.players.flatMap((p) => [...p.discards, ...p.melds.flatMap((m) => m.tiles)]),
    ];
  }

  // AI 老師:打牌前先套用麻將學園的技巧講評目前盤勢。這裡是真的 4 人對局,場上看得到
  // 其他 3 家的棄牌跟副露,所以除了牌效(第一章)之外,也能套用第二、四章跟巡目/防守
  // 有關的部分 —— 直接呼叫 chooseAiDiscardWithReason(你也是它的其中一個使用者,跟 AI 對手
  // 同一套邏輯),連同它回傳的「為什麼選這張」理由一起顯示,不會自己另外猜一套說法出來
  // 跟實際判斷邏輯兜不起來。
  function buildTeacherAdvice(you) {
    const results = analyzeDiscardsGeneral(you.hand, you.melds, visibleTilesFor(you));
    const pureBest = results[0];
    const { code: recommendedCode, reason } = chooseAiDiscardWithReason(you, game);
    const recommended = results.find((r) => r.discard === recommendedCode) ?? pureBest;

    const turn = you.drawCount;
    const phase = turn <= 6 ? '前盤' : turn <= 11 ? '中盤' : '後盤';

    const describe = (r) =>
      r.shanten === 0
        ? `打「${tileDisplayName(tileFromCode(r.discard))}」,打出去就聽 ${describeUseful(r.usefulTiles)}`
        : `打「${tileDisplayName(tileFromCode(r.discard))}」:${describeShanten(r.shanten)},期望進張 ${r.ukeire} 張`;

    const lines = [];

    if (recommended.shanten <= -1) {
      lines.push('這手已經可以胡了,別猶豫,直接自摸!');
    } else if (recommended.discard === pureBest.discard) {
      lines.push(`老師建議:${describe(recommended)}。`);
    } else {
      const recommendedTile = tileFromCode(recommended.discard);
      const reasonText =
        reason === 'lateFold'
          ? '後盤還沒聽牌,優先打現張比較安全(第二章「巡目推進防禦標準」)'
          : reason === 'isolation'
            ? `兩種打法效率打平,這張是孤張${describeIsolationKind(
                recommendedTile
              )},比較沒有發展性,效率打平時優先拆這種孤張(基礎牌理:字牌 > 么九 > 2、8 > 中間張)`
            : reason === 'exposure'
              ? '兩種打法效率打平,但這張場上已經曝光比較多,對手比較不容易吃碰或胡走(第四章防守精準化的公開資訊版)'
              : '兩種打法效率完全一樣,打哪張都可以,這裡只是照預設順序挑一張,沒有特別理由';
      lines.push(
        `效率最佳解是${describe(pureBest)},但老師建議改打「${tileDisplayName(recommendedTile)}」:${reasonText}。`
      );
    }

    if (phase === '前盤') {
      lines.push(`現在第 ${turn} 巡(前盤):效率最大化,先拆字牌跟用不到的孤張。`);
    } else if (phase === '中盤') {
      lines.push(`現在第 ${turn} 巡(中盤):留意場面,若落後兩進聽以上又沒有大牌潛力,可以考慮轉守。`);
    } else {
      lines.push(`現在第 ${turn} 巡(後盤):沒聽牌的話該收手了,聽牌的話可以放心進攻。`);
    }

    return lines;
  }

  function renderTeacherHint(you) {
    const box = document.createElement('div');
    box.className = 'teacher-hint teacher-hint-table';

    const title = document.createElement('p');
    title.className = 'teacher-hint-title';
    title.textContent = '🀄 AI 老師';
    box.appendChild(title);

    for (const line of buildTeacherAdvice(you)) {
      const p = document.createElement('p');
      p.className = 'teacher-hint-line';
      p.textContent = line;
      box.appendChild(p);
    }

    return box;
  }

  function processCallGroups(groups, index, discarderSeat, tile) {
    if (index >= groups.length) {
      skipCall(game, discarderSeat);
      return true;
    }
    const group = groups[index];
    const player = game.players[group.seat];

    if (player.isHuman) {
      pendingCallPrompt = { discarderSeat, tile, groups, index, group };
      return false; // 暫停,等玩家決定
    }

    const decision = chooseAiCallDecision(player, group, tile);
    if (decision) {
      if (decision.type === 'pon') {
        applyPon(game, group.seat, discarderSeat, tile);
      } else if (decision.type === 'kan') {
        const { canWin } = applyMinkan(game, group.seat, discarderSeat, tile);
        if (canWin) declareTsumo(game, { isRinshan: true }); // 叫槓補到的牌剛好自摸(槓上開花)
      } else {
        applyChi(game, group.seat, discarderSeat, tile, decision.otherRanks);
      }
      return true;
    }
    return processCallGroups(groups, index + 1, discarderSeat, tile);
  }

  function resolveCallOpportunities(discarderSeat, tile) {
    const groups = computeCallOpportunities(game, discarderSeat, tile);
    return processCallGroups(groups, 0, discarderSeat, tile);
  }

  // 一張牌打出去之後:先看有沒有人可以點炮胡,沒有才輪到吃碰。
  // 回傳 true 表示已經處理完(可能贏了、可能沒人理牌,可以繼續跑下去);
  // 回傳 false 表示暫停,等玩家決定要不要胡。
  function resolveDiscardAftermath(discarderSeat, tile) {
    const ronSeat = findRonOpportunity(game, discarderSeat, tile);
    if (ronSeat !== null) {
      const player = game.players[ronSeat];
      if (player.isHuman) {
        pendingRonPrompt = { discarderSeat, tile, ronSeat };
        return false;
      }
      applyRon(game, ronSeat, discarderSeat, tile); // AI 一律接受點炮胡牌
      return true;
    }
    return resolveCallOpportunities(discarderSeat, tile);
  }

  // AI 摸牌後貪心宣告暗槓/加槓(能槓就一定槓):加槓要先看有沒有人可以搶槓,
  // 真人可以搶的話要暫停等真人決定(回傳 'paused'),AI 一律直接接受搶槓。
  // 槓後補到的牌能自摸就直接自摸(槓上開花)。
  // 回傳 true 表示已經處理完(可能槓了、可能自摸、可能流局),false 表示這個人沒有槓可以宣告。
  function performAiKanIfPossible(player) {
    for (;;) {
      const ankanCode = findAnkanOptions(player)[0];
      if (ankanCode) {
        const { drewTile, canWin } = applyAnkan(game, player.seat, ankanCode);
        if (!drewTile) return true; // 牌牆抽光,流局
        if (canWin) {
          declareTsumo(game, { isRinshan: true });
          return true;
        }
        continue;
      }

      const kakanCode = findKakanOptions(player)[0];
      if (kakanCode) {
        const tile = beginKakan(game, player.seat, kakanCode);
        const robberSeat = findChankanOpportunity(game, player.seat, tile);
        if (robberSeat !== null) {
          if (game.players[robberSeat].isHuman) {
            pendingChankanPrompt = { kanSeat: player.seat, tile };
            return 'paused';
          }
          applyChankan(game, robberSeat, player.seat, tile);
          return true;
        }
        const { drewTile, canWin } = finalizeKakan(game, player.seat, tile);
        if (!drewTile) return true;
        if (canWin) {
          declareTsumo(game, { isRinshan: true });
          return true;
        }
        continue;
      }

      return false;
    }
  }

  // AI 打出一張牌:馬上顯示(讓那張牌開始閃爍),接著看有沒有人要點炮/吃碰槓 ——
  // 真人有得選就停在這裡(牌持續閃爍,等真人決定);沒有人要決定的話,讓那張牌
  // 閃爍 AI_DISCARD_PAUSE_MS 毫秒,再繼續往下一步(不會卡住畫面,靠計時器接續)。
  function performAiDiscardStep(seat) {
    const player = game.players[seat];
    const discardCode = chooseAiDiscard(player, game);
    const tile = discard(game, discardCode);
    lastDiscard = { seat, code: tileCode(tile) };
    render();

    const resolved = resolveDiscardAftermath(seat, tile);
    render();
    if (!resolved || game.finished) return; // 暫停等真人決定,或牌局已經結束,都不用排下一步

    setTimeout(() => advanceUntilHumanOrEnd(), AI_DISCARD_PAUSE_MS);
  }

  // 走一步流程,走到「輪到真人決定」或「牌局結束」就停下來;
  // AI 出牌後如果沒人需要決定,會透過 setTimeout 延遲後自己再呼叫一次繼續走下去。
  function advanceUntilHumanOrEnd() {
    if (game.finished) {
      render();
      return;
    }

    const seat = game.currentSeat;
    const player = game.players[seat];

    if (game.mustDiscard) {
      game.mustDiscard = false;
      pendingDrewCode = null;
      pendingCanWin = false;
      pendingIsRinshan = false;
      if (player.isHuman) {
        lastDiscard = null; // 輪到真人了,不用再顯示上一張 AI 棄牌的閃爍
        render();
        return; // 剛吃/碰/槓完,等玩家選要打哪張
      }

      performAiDiscardStep(seat);
      return;
    }

    const { drewTile, canWin } = drawForCurrentPlayer(game);
    if (game.finished) {
      render();
      return;
    }

    if (player.isHuman) {
      lastDiscard = null;
      pendingDrewCode = drewTile ? tileCode(drewTile) : null;
      pendingCanWin = canWin;
      pendingIsRinshan = false;
      render();
      return; // 等玩家決定要不要自摸、要不要槓,或是點牌打出去
    }

    if (canWin) {
      declareTsumo(game);
      render();
      return;
    }

    const kanResult = performAiKanIfPossible(player);
    if (kanResult === 'paused') {
      render();
      return; // 等真人決定要不要搶槓
    }
    if (game.finished) {
      render();
      return;
    }

    performAiDiscardStep(seat);
  }

  // 點一張牌只是「候選」,還沒真的打出去 —— 要按確認才會算分析,
  // 分析完如果不是最佳解,可以撤回重新選,不會浪費這次出牌。
  function selectDiscardCandidate(code) {
    pendingDiscardChoice = code;
    pendingDiscardPreview = null;
    render();
  }

  function confirmDiscardCandidate() {
    if (!pendingDiscardChoice) return;
    const you = game.players[0];
    const analysis = analyzeDiscardsGeneral(you.hand, you.melds, visibleTilesFor(you));
    const best = analysis[0];
    const chosen = analysis.find((r) => r.discard === pendingDiscardChoice);
    const isOptimal = chosen.shanten === best.shanten && chosen.ukeire === best.ukeire;
    pendingDiscardPreview = { code: pendingDiscardChoice, isOptimal, chosen, best };
    render();
  }

  function undoDiscardCandidate() {
    pendingDiscardChoice = null;
    pendingDiscardPreview = null;
    render();
  }

  function commitDiscard() {
    if (!pendingDiscardPreview) return; // 防止按鈕被連點兩次、狀態已經清過又被呼叫一次
    const code = pendingDiscardPreview.code;
    pendingDiscardChoice = null;
    pendingDiscardPreview = null;

    const discarderSeat = 0;
    const player = game.players[discarderSeat];
    // 摸到能自摸的牌卻選擇繼續打牌,算過水:整組聽牌都不能胡,直到自己下一次打牌才解除。
    // 要先把「放棄前」的聽牌範圍記下來,discard() 會先清空過水狀態,打完牌才重新設回去。
    const declinedWaitCodes = pendingCanWin ? tenpaiWaitCodesFor(player, { declinedSelfDraw: true }) : null;
    const tile = discard(game, code);
    if (declinedWaitCodes) player.furitenTiles = declinedWaitCodes;
    pendingDrewCode = null;
    pendingCanWin = false;
    pendingIsRinshan = false;
    if (resolveDiscardAftermath(discarderSeat, tile)) {
      advanceUntilHumanOrEnd();
    }
    render();
  }

  function humanDeclareTsumo() {
    declareTsumo(game, { isRinshan: pendingIsRinshan });
    render();
  }

  function humanDeclareAnkan(code) {
    const result = applyAnkan(game, 0, code);
    pendingDrewCode = result.drewTile ? tileCode(result.drewTile) : null;
    pendingCanWin = result.canWin;
    pendingIsRinshan = true;
    pendingDiscardChoice = null;
    pendingDiscardPreview = null;
    render();
  }

  function humanDeclareKakan(code) {
    const tile = beginKakan(game, 0, code);
    const robberSeat = findChankanOpportunity(game, 0, tile);
    if (robberSeat !== null) {
      // 自己加槓只有 AI 可能搶(不會搶自己),AI 一律直接接受搶槓
      applyChankan(game, robberSeat, 0, tile);
      render();
      return;
    }
    const result = finalizeKakan(game, 0, tile);
    pendingDrewCode = result.drewTile ? tileCode(result.drewTile) : null;
    pendingCanWin = result.canWin;
    pendingIsRinshan = true;
    pendingDiscardChoice = null;
    pendingDiscardPreview = null;
    render();
  }

  function humanCallChoice(choice) {
    if (!pendingCallPrompt) return; // 防止按鈕被連點兩次
    const { discarderSeat, tile, groups, index } = pendingCallPrompt;
    pendingCallPrompt = null;

    if (choice === 'pass') {
      if (processCallGroups(groups, index + 1, discarderSeat, tile)) advanceUntilHumanOrEnd();
      render();
      return;
    }

    if (choice.type === 'pon') {
      applyPon(game, 0, discarderSeat, tile);
      advanceUntilHumanOrEnd();
      render();
      return;
    }

    if (choice.type === 'kan') {
      const result = applyMinkan(game, 0, discarderSeat, tile);
      pendingDrewCode = result.drewTile ? tileCode(result.drewTile) : null;
      pendingCanWin = result.canWin;
      pendingIsRinshan = true;
      render();
      return; // 不呼叫 advanceUntilHumanOrEnd —— 現在輪到玩家自己決定要不要自摸/打哪張
    }

    applyChi(game, 0, discarderSeat, tile, choice.otherRanks);
    advanceUntilHumanOrEnd();
    render();
  }

  // 按「略過」不會馬上跳過,先算一次分析:叫了(碰/槓/吃)向聽數會不會變好,
  // 讓玩家看完再決定要不要真的略過,跟打牌前的撤回機制是同一套邏輯。
  function previewPassChoice() {
    if (!pendingCallPrompt) return; // 防止按鈕被連點兩次
    const { discarderSeat, tile, group } = pendingCallPrompt;
    const player = game.players[0];
    const beforeShanten = calculateShanten(player.hand, player.melds.length);
    const decision = chooseAiCallDecision(player, group, tile);
    pendingPassPreview = { beforeShanten, decision };
    render();
  }

  function undoPassPreview() {
    pendingPassPreview = null;
    render();
  }

  function confirmPass() {
    pendingPassPreview = null;
    humanCallChoice('pass');
  }

  function humanChankanChoice(accept) {
    if (!pendingChankanPrompt) return; // 防止按鈕被連點兩次
    const { kanSeat, tile } = pendingChankanPrompt;
    pendingChankanPrompt = null;

    if (accept) {
      applyChankan(game, 0, kanSeat, tile);
      render();
      return;
    }

    // 不搶,加槓正式完成;如果補到的牌剛好讓對方自摸(槓上開花),AI 一律直接自摸
    const result = finalizeKakan(game, kanSeat, tile);
    if (result.drewTile && result.canWin) {
      declareTsumo(game, { isRinshan: true });
    }
    if (!game.finished) advanceUntilHumanOrEnd();
    render();
  }

  function humanRonChoice(accept) {
    if (!pendingRonPrompt) return; // 防止按鈕被連點兩次
    const { discarderSeat, tile } = pendingRonPrompt;
    pendingRonPrompt = null;

    let resolved;
    if (accept) {
      applyRon(game, 0, discarderSeat, tile);
      resolved = true; // 遊戲結束了
    } else {
      markFuriten(game.players[0]); // 點炮不胡,過水:整組聽牌都不能胡,直到自己下一次打牌才解除
      resolved = resolveCallOpportunities(discarderSeat, tile); // 不胡的話,照樣檢查有沒有人要吃碰
    }

    if (resolved) advanceUntilHumanOrEnd();
    render();
  }

  function renderRonPrompt(container) {
    const { discarderSeat, tile } = pendingRonPrompt;
    const label = document.createElement('p');
    label.className = 'hint';
    label.textContent = `${seatLabel(discarderSeat)} 放槍了!打出「${tileDisplayName(tile)}」剛好完成你的胡牌,要胡嗎?`;
    container.appendChild(label);
    container.appendChild(renderTileRow([tile]));

    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons';
    const ronBtn = document.createElement('button');
    ronBtn.type = 'button';
    ronBtn.className = 'action-btn';
    ronBtn.textContent = '胡牌!';
    ronBtn.addEventListener('click', () => humanRonChoice(true));
    btnRow.appendChild(ronBtn);

    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.className = 'action-btn action-btn-pass';
    passBtn.textContent = '不胡,略過';
    passBtn.addEventListener('click', () => humanRonChoice(false));
    btnRow.appendChild(passBtn);
    container.appendChild(btnRow);
  }

  // 自己的手牌列(置中放在綠色桌布上):手牌 → 確認按鈕(如果有) → 面子,由左到右排開
  function buildYourHandRow(handRowEl, confirmBtnEl, player) {
    const handWrap = document.createElement('div');
    handWrap.className = 'hand-with-melds';
    handWrap.appendChild(handRowEl);
    if (confirmBtnEl) handWrap.appendChild(confirmBtnEl);

    const isWinner = winningSeat() === player.seat;
    const hasDiscards = player.discards.length > 0;
    const hasMelds = player.melds.length > 0;
    if (!hasDiscards && !hasMelds) {
      if (!isWinner) return handWrap;
      const column = document.createElement('div');
      column.className = 'your-hand-column';
      column.appendChild(buildWinBadge());
      column.appendChild(handWrap);
      return column;
    }

    const column = document.createElement('div');
    column.className = 'your-hand-column';
    if (isWinner) column.appendChild(buildWinBadge());

    // 自己打出去的牌顯示在手牌正上方、置中
    if (hasDiscards) {
      const discardRow = renderTileRow(player.discards, { small: true });
      discardRow.classList.add('your-discard-row');
      column.appendChild(discardRow);
    }

    // 自己吃碰槓的面子也放在手牌上方,但靠右(跟置中的打出牌分開,不會擠在一起)
    if (hasMelds) {
      const extrasRow = document.createElement('div');
      extrasRow.className = 'your-extras-row';
      const meldsBlock = document.createElement('div');
      meldsBlock.className = 'seat-melds-block melds-horizontal';
      renderMelds(meldsBlock, player, { small: true, showLabel: false });
      extrasRow.appendChild(meldsBlock);
      column.appendChild(extrasRow);
    }

    column.appendChild(handWrap);
    return column;
  }

  // 手牌 + (胡牌時)點炮的那張牌 + 吃碰槓的面子,由左到右放在同一行(用於攤牌時列出四家)
  // winningTile:如果這家是點炮胡牌的贏家,把放槍的那張牌顯示在手牌右邊、面子左邊,並特別標出來
  function appendHandWithMelds(container, handRowEl, player, winningTile) {
    if (player.melds.length === 0 && !winningTile) {
      container.appendChild(handRowEl);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'hand-with-melds';
    wrap.appendChild(handRowEl);
    if (winningTile) {
      const winningTileRow = renderTileRow([winningTile]);
      winningTileRow.classList.add('winning-tile-row');
      wrap.appendChild(winningTileRow);
    }
    if (player.melds.length > 0) {
      const meldsBlock = document.createElement('div');
      meldsBlock.className = 'seat-melds-block melds-horizontal'; // 自己的好幾組面子要水平排一列,不要一組一行疊起來
      renderMelds(meldsBlock, player, { small: true, showLabel: false }); // 自己的面子不用標示吃碰槓,看牌就知道
      wrap.appendChild(meldsBlock);
    }
    container.appendChild(wrap);
  }

  // 每組面子(標籤+牌)包成自己的一個小區塊,這樣不管外層容器是直排還是橫排,
  // 標籤都會穩穩貼在自己那組牌上面,不會在橫排換行時跟牌組拆散。
  function renderMelds(container, player, { small, showLabel = true } = {}) {
    for (const meld of player.melds) {
      const group = document.createElement('div');
      group.className = 'meld-group';
      if (showLabel) {
        const label = document.createElement('p');
        label.className = 'hint';
        label.style.margin = small ? '2px 0' : '4px 0 2px';
        label.textContent = MELD_LABEL[meld.type] ?? meld.type;
        group.appendChild(label);
      }
      group.appendChild(renderTileRow(meld.tiles, { small }));
      container.appendChild(group);
    }
  }

  function renderChankanPrompt(container) {
    const { kanSeat, tile } = pendingChankanPrompt;
    const label = document.createElement('p');
    label.className = 'hint';
    label.textContent = `${seatLabel(kanSeat)} 正在加槓「${tileDisplayName(tile)}」,你要搶槓胡嗎?`;
    container.appendChild(label);
    container.appendChild(renderTileRow([tile]));

    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons';
    const robBtn = document.createElement('button');
    robBtn.type = 'button';
    robBtn.className = 'action-btn';
    robBtn.textContent = '搶槓胡牌!';
    robBtn.addEventListener('click', () => humanChankanChoice(true));
    btnRow.appendChild(robBtn);

    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.className = 'action-btn action-btn-pass';
    passBtn.textContent = '不搶,略過';
    passBtn.addEventListener('click', () => humanChankanChoice(false));
    btnRow.appendChild(passBtn);
    container.appendChild(btnRow);
  }

  // 剩餘牌數,固定顯示在桌面右上角(不占中間版面,不會被浮動的面子擋到)。
  function buildWallIndicator() {
    const wrap = document.createElement('div');
    wrap.className = 'wall-indicator-corner';
    wrap.textContent = `剩 ${game.wall.length} 張`;
    return wrap;
  }

  function buildSeatCard(seat) {
    const player = game.players[seat];
    const card = document.createElement('div');
    card.className = seat === 0 ? 'seat-card seat-dealer' : 'seat-card';
    if (winningSeat() === seat) card.appendChild(buildWinBadge());

    const header = document.createElement('div');
    header.className = 'seat-header';

    const identity = seatIdentity[seat];
    const avatar = document.createElement('div');
    avatar.className = 'seat-avatar';
    if (identity) {
      const avatarImg = document.createElement('img');
      avatarImg.src = identity.avatar;
      avatarImg.alt = identity.name;
      avatar.appendChild(avatarImg);
    } else {
      avatar.textContent = SEAT_WIND[seat];
    }
    header.appendChild(avatar);

    const nameBlock = document.createElement('div');
    nameBlock.className = 'seat-name-block';
    const nameEl = document.createElement('div');
    nameEl.className = 'seat-name';
    nameEl.textContent = identity ? identity.name : SEAT_SHORT_NAME[seat];
    if (seat === 0) {
      const badge = document.createElement('span');
      badge.className = 'dealer-badge';
      badge.textContent = '莊';
      nameEl.appendChild(badge);
    }
    nameBlock.appendChild(nameEl);

    const meta = document.createElement('div');
    meta.className = 'seat-meta';
    meta.textContent =
      seat === 0
        ? `手牌 ${player.hand.length} 張`
        : `${POSITION_LABEL[seat]}・手牌 ${player.hand.length} 張・棄牌 ${player.discards.length} 張${
            player.melds.length > 0 ? `・吃碰槓 ${player.melds.length} 組` : ''
          }`;
    nameBlock.appendChild(meta);
    header.appendChild(nameBlock);
    card.appendChild(header);

    if (player.discards.length > 0) {
      const discardRow = renderTileRow(player.discards, { small: true });

      if (lastDiscard && lastDiscard.seat === seat) {
        const lastTileBtn = discardRow.lastElementChild;
        if (lastTileBtn) lastTileBtn.classList.add('tile-blink');
      }

      // 真人正要決定吃碰槓(還沒進入「略過分析」畫面)的話,選項按鈕直接放在這張閃爍的牌旁邊
      if (pendingCallPrompt && !pendingPassPreview && pendingCallPrompt.discarderSeat === seat) {
        const wrap = document.createElement('div');
        wrap.className = 'discard-with-call';
        wrap.appendChild(discardRow);
        wrap.appendChild(buildCallOptionButtons(pendingCallPrompt.group));
        card.appendChild(wrap);
      } else {
        card.appendChild(discardRow);
      }
    }

    return card;
  }

  // 吃/碰/槓/略過的按鈕組,原本只用在真人叫牌提示,現在也直接嵌在牌桌上那張閃爍的棄牌旁邊
  function buildCallOptionButtons(group) {
    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons inline-call-buttons';
    for (const option of group.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn';
      btn.textContent = describeCallOption(option);
      btn.addEventListener('click', () => humanCallChoice(option));
      btnRow.appendChild(btn);
    }
    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.className = 'action-btn action-btn-pass';
    passBtn.textContent = '略過';
    passBtn.addEventListener('click', previewPassChoice);
    btnRow.appendChild(passBtn);
    return btnRow;
  }

  // 吃碰槓的面子獨立出來,方便依座位擺在不同位置(上家/下家放座位上面,對面放座位下面)。
  // 橫向排、空間不夠自動換行,不要一組疊一行往下長,牌桌高度才不會隨吃碰次數暴衝;
  // 不顯示「碰/吃/槓」文字標籤,牌組本身的花色排列就看得出叫的是什麼,可以再省一行高度
  function buildMeldsBlock(seat) {
    const player = game.players[seat];
    const block = document.createElement('div');
    block.className = 'seat-melds-block melds-horizontal';
    renderMelds(block, player, { small: true, showLabel: false });
    return block;
  }

  // 選項按鈕已經直接嵌在牌桌上閃爍的那張棄牌旁邊(見 buildSeatCard),這裡只留文字說明。
  function renderCallPrompt(container) {
    const { discarderSeat, tile } = pendingCallPrompt;
    const label = document.createElement('p');
    label.className = 'hint';
    label.textContent = `${seatLabel(discarderSeat)} 打出「${tileDisplayName(
      tile
    )}」,你要吃碰嗎?在牌桌上閃爍的那張牌旁邊選擇。`;
    container.appendChild(label);
  }

  function renderPassPreview(container) {
    const { beforeShanten, decision } = pendingPassPreview;
    const verdict = document.createElement('p');
    verdict.className = decision ? 'verdict wrong' : 'verdict correct';
    verdict.textContent = decision
      ? `✗ 其實可以${describeCallOption(decision)}:${describeShanten(beforeShanten)} → ${describeShanten(
          decision.afterShanten
        )}`
      : `✓ 略過是對的:${describeShanten(beforeShanten)},叫了向聽數也不會變好`;
    container.appendChild(verdict);

    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons';
    if (decision) {
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'action-btn action-btn-pass';
      backBtn.textContent = '撤回,重新選';
      backBtn.addEventListener('click', undoPassPreview);
      btnRow.appendChild(backBtn);
    }
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'action-btn';
    confirmBtn.textContent = decision ? '還是要略過,繼續' : '略過,繼續';
    confirmBtn.addEventListener('click', confirmPass);
    btnRow.appendChild(confirmBtn);
    container.appendChild(btnRow);
  }

  function buildTable(bottomContentEl, middleHintEl) {
    const table = document.createElement('div');
    table.className = 'mahjong-table';

    table.appendChild(buildWallIndicator());

    const topRow = document.createElement('div');
    topRow.className = 'seat-row-top';
    const topGroup = document.createElement('div');
    topGroup.className = 'seat-with-melds-below';
    topGroup.appendChild(buildSeatCard(2));
    topGroup.appendChild(buildMeldsBlock(2)); // 對面吃碰槓的牌放座位下面
    topRow.appendChild(topGroup);
    table.appendChild(topRow);

    const middleRow = document.createElement('div');
    middleRow.className = 'seat-row-middle';

    const upperGroup = document.createElement('div');
    upperGroup.className = 'seat-with-melds-above';
    upperGroup.appendChild(buildMeldsBlock(3)); // 上家吃碰槓的牌放座位上面
    upperGroup.appendChild(buildSeatCard(3)); // 上家放左邊
    middleRow.appendChild(upperGroup);

    const lowerGroup = document.createElement('div');
    lowerGroup.className = 'seat-with-melds-above';
    lowerGroup.appendChild(buildMeldsBlock(1)); // 下家吃碰槓的牌放座位上面
    lowerGroup.appendChild(buildSeatCard(1)); // 下家放右邊
    middleRow.appendChild(lowerGroup);

    table.appendChild(middleRow);

    if (middleHintEl) table.appendChild(middleHintEl);

    if (bottomContentEl) {
      const bottomRow = document.createElement('div');
      bottomRow.className = 'seat-row-bottom';
      bottomRow.appendChild(bottomContentEl);
      table.appendChild(bottomRow);
    }

    return table;
  }

  function render() {
    if (!container || !game) return; // game 一定要先靠 mount()/newGame() 準備好,render() 不能自己觸發 newGame()
    container.innerHTML = '';

    if (onActiveChange) onActiveChange(!game.finished); // 對局進行中就通知外層隱藏標題/頁籤,結束了再顯示回來

    const you = game.players[0];

    // 手牌列一律置中放在綠色桌布上;只有真的輪到真人自己決定(座位 0、沒有其他提示卡著)
    // 才是「一般回合」,才會跟著一顆「確認要打的牌」按鈕 —— AI 出牌後閃爍等待的那 2 秒
    // 雖然也沒有任何 pending 提示,但 currentSeat 不是真人,不能被誤判成一般回合。
    const isNormalTurn =
      game.currentSeat === 0 &&
      !game.finished &&
      !pendingRonPrompt &&
      !pendingCallPrompt &&
      !pendingChankanPrompt &&
      !pendingDiscardPreview;

    let handRowEl;
    if (pendingDiscardPreview) {
      handRowEl = renderTileRow(sortTiles(you.hand), { selectedCode: pendingDiscardPreview.code });
    } else if (isNormalTurn) {
      handRowEl = renderTileRow(sortTiles(you.hand), {
        onClick: (code) => selectDiscardCandidate(code),
        selectedCode: pendingDiscardChoice ?? pendingDrewCode,
      });
    } else {
      handRowEl = renderTileRow(sortTiles(you.hand));
    }

    let confirmBtnEl = null;
    if (isNormalTurn) {
      confirmBtnEl = document.createElement('button');
      confirmBtnEl.type = 'button';
      confirmBtnEl.className = 'action-btn';
      confirmBtnEl.textContent = '確認要打的牌';
      confirmBtnEl.disabled = !pendingDiscardChoice;
      confirmBtnEl.addEventListener('click', confirmDiscardCandidate);
    } else if (pendingDiscardPreview) {
      // 打出/撤回的按鈕跟確認按鈕一樣,放在桌布上手牌右邊,不必等捲到面板才看得到
      confirmBtnEl = document.createElement('div');
      confirmBtnEl.className = 'action-buttons';
      if (!pendingDiscardPreview.isOptimal) {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'action-btn action-btn-pass';
        undoBtn.textContent = '撤回,重新選';
        undoBtn.addEventListener('click', undoDiscardCandidate);
        confirmBtnEl.appendChild(undoBtn);
      }
      const goBtn = document.createElement('button');
      goBtn.type = 'button';
      goBtn.className = 'action-btn';
      goBtn.textContent = pendingDiscardPreview.isOptimal ? '打出,繼續' : '還是要打這張,繼續';
      goBtn.addEventListener('click', commitDiscard);
      confirmBtnEl.appendChild(goBtn);
    }

    const teacherHintEl = isNormalTurn ? renderTeacherHint(you) : null;
    container.appendChild(buildTable(buildYourHandRow(handRowEl, confirmBtnEl, you), teacherHintEl));

    const panel = document.createElement('div');
    // 結算畫面內容很長,不要用黏底(sticky)排版,不然會蓋到還沒捲到的牌桌內容
    panel.className = game.finished ? 'your-hand-panel your-hand-panel-result' : 'your-hand-panel';
    container.appendChild(panel);

    if (game.finished) {
      renderResult(panel);
      renderRevealedHands(panel);
      const restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.className = 'action-btn';
      restartBtn.textContent = '再開一局';
      restartBtn.addEventListener('click', () => {
        newGame(); // newGame() 自己會走到 render(),不要在這裡又呼叫一次造成重複畫面
      });
      panel.appendChild(restartBtn);
      return;
    }

    if (pendingRonPrompt) {
      renderRonPrompt(panel);
      return;
    }

    if (pendingCallPrompt && pendingPassPreview) {
      renderPassPreview(panel);
      return;
    }

    if (pendingCallPrompt) {
      renderCallPrompt(panel);
      return;
    }

    if (pendingChankanPrompt) {
      renderChankanPrompt(panel);
      return;
    }

    // 已經按過確認,顯示分析結果 + 撤回重選/照打繼續 的選擇
    if (pendingDiscardPreview) {
      // analyzeDiscardsGeneral 沒有 isTenpai 欄位(任何向聽數都能分析),
      // 一律用 describeShanten 說明實際差幾步聽牌,而不是籠統地說「沒有聽牌」
      const describeHead = (r) =>
        `打「${tileDisplayName(tileFromCode(r.discard))}」:${describeShanten(
          r.shanten
        )},期望進張 ${r.ukeire} 張`;

      // 兩種打法的期望進張清單通常有九成重疊,直接列全部反而看不出差在哪 ——
      // 只列「這個選項有、另一個選項沒有」的牌,才是真正造成張數差異的關鍵牌。
      const onlyIn = (mine, other) => {
        const otherCodes = new Set(other.map((u) => u.code));
        const diff = mine.filter((u) => !otherCodes.has(u.code));
        return diff.length === 0 ? '無' : describeUseful(diff);
      };

      const feedback = document.createElement('div');
      feedback.className = 'feedback';
      const verdict = document.createElement('p');
      verdict.className = pendingDiscardPreview.isOptimal ? 'verdict correct' : 'verdict wrong';
      verdict.textContent = pendingDiscardPreview.isOptimal ? '✓ 這是最佳解!' : '✗ 還有更好的打法';
      feedback.appendChild(verdict);

      if (pendingDiscardPreview.isOptimal) {
        const mineP = document.createElement('p');
        mineP.textContent = `你的選擇 —— ${describeHead(pendingDiscardPreview.chosen)} —— ${describeUseful(
          pendingDiscardPreview.chosen.usefulTiles
        )}`;
        feedback.appendChild(mineP);
      } else {
        const { chosen, best } = pendingDiscardPreview;
        const mineP = document.createElement('p');
        mineP.textContent = `你的選擇 —— ${describeHead(chosen)}(比最佳解多算的牌:${onlyIn(
          chosen.usefulTiles,
          best.usefulTiles
        )})`;
        feedback.appendChild(mineP);

        const bestP = document.createElement('p');
        bestP.textContent = `最佳解 —— ${describeHead(best)}(比你的選擇多算的牌:${onlyIn(
          best.usefulTiles,
          chosen.usefulTiles
        )})`;
        feedback.appendChild(bestP);
      }
      panel.appendChild(feedback);
      // 打出/撤回按鈕已經跟著手牌畫在桌布上了(見上方 confirmBtnEl),這裡不重複放
      return;
    }

    if (!isNormalTurn && !game.finished) {
      // 還沒輪到真人(AI 出牌後正在閃爍、等 2 秒繼續下一步),面板不用顯示任何操作項目
      const waitingSeat = lastDiscard ? lastDiscard.seat : game.currentSeat;
      const waitingP = document.createElement('p');
      waitingP.className = 'hint';
      waitingP.textContent = `${seatLabel(waitingSeat)} 剛打出的牌正在牌桌上顯示...`;
      panel.appendChild(waitingP);
      return;
    }

    // 一般回合:還沒選、或選了但還沒按確認(手牌+確認按鈕已經畫在桌布上了,這裡只剩提示文字跟其他按鈕)
    const canDeclareTsumo = pendingCanWin;
    const ankanOptions = findAnkanOptions(you);
    const kakanOptions = findKakanOptions(you);

    const analysis = analyzeDiscardsGeneral(you.hand, you.melds, visibleTilesFor(you));
    const best = analysis[0];
    const shantenP = document.createElement('p');
    shantenP.className = 'hint';
    shantenP.textContent = `目前最好的狀態:${describeShanten(best.shanten)}・期望進張 ${
      best.ukeire
    } 張 —— ${describeUseful(best.usefulTiles)}`;
    panel.appendChild(shantenP);

    const waitP = document.createElement('p');
    waitP.className = 'hint';
    waitP.textContent = canDeclareTsumo
      ? '這手牌可以自摸胡牌了!也可以選擇不胡,點一張牌繼續打下去。'
      : '點一張牌,選好之後按「確認要打的牌」——不是最佳解的話還能撤回重選。';
    panel.appendChild(waitP);

    const actionRow = document.createElement('div');
    actionRow.className = 'action-buttons';

    if (canDeclareTsumo) {
      const tsumoBtn = document.createElement('button');
      tsumoBtn.type = 'button';
      tsumoBtn.className = 'action-btn';
      tsumoBtn.textContent = pendingIsRinshan ? '槓上開花,自摸胡牌!' : '自摸胡牌!';
      tsumoBtn.addEventListener('click', humanDeclareTsumo);
      actionRow.appendChild(tsumoBtn);
    }

    for (const code of ankanOptions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn action-btn-secondary';
      btn.textContent = `暗槓:${tileDisplayName(tileFromCode(code))}`;
      btn.addEventListener('click', () => humanDeclareAnkan(code));
      actionRow.appendChild(btn);
    }

    for (const code of kakanOptions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn action-btn-secondary';
      btn.textContent = `加槓:${tileDisplayName(tileFromCode(code))}`;
      btn.addEventListener('click', () => humanDeclareKakan(code));
      actionRow.appendChild(btn);
    }

    panel.appendChild(actionRow);
  }

  function buildWinAnnounce(titleText) {
    const announce = document.createElement('div');
    announce.className = 'win-announce';
    const title = document.createElement('div');
    title.className = 'win-title';
    title.textContent = titleText;
    announce.appendChild(title);
    return announce;
  }

  function renderResult(container) {
    if (game.result.type === 'tsumo') {
      container.appendChild(buildWinAnnounce('自摸'));
    } else if (game.result.type === 'ron') {
      container.appendChild(buildWinAnnounce('胡牌'));
    } else {
      container.appendChild(buildWinAnnounce('流局'));
    }

    const box = document.createElement('div');
    box.className = 'feedback';
    if (game.result.type === 'draw') {
      const p = document.createElement('p');
      p.className = 'verdict wrong';
      p.textContent = '牌牆摸完了。';
      box.appendChild(p);
    } else if (game.result.type === 'tsumo') {
      const seat = game.result.seat;
      const p = document.createElement('p');
      p.className = seat === 0 ? 'verdict correct' : 'verdict wrong';
      p.textContent =
        seat === 0
          ? `你自摸胡牌!總共 ${game.result.score.total} 台`
          : `${seatLabel(seat)} 自摸胡牌,總共 ${game.result.score.total} 台`;
      box.appendChild(p);
      const list = document.createElement('ul');
      for (const item of game.result.score.items) {
        const li = document.createElement('li');
        li.textContent = `${item.name}:${item.tai} 台`;
        list.appendChild(li);
      }
      box.appendChild(list);
    } else if (game.result.type === 'ron') {
      const { winnerSeat, discarderSeat } = game.result;
      const p = document.createElement('p');
      p.className = winnerSeat === 0 ? 'verdict correct' : 'verdict wrong';
      const winnerText = winnerSeat === 0 ? '你' : seatLabel(winnerSeat);
      const discarderText = discarderSeat === 0 ? '你' : seatLabel(discarderSeat);
      p.textContent = `${discarderText}放槍,${winnerText}胡牌!總共 ${game.result.score.total} 台`;
      box.appendChild(p);
      const list = document.createElement('ul');
      for (const item of game.result.score.items) {
        const li = document.createElement('li');
        li.textContent = `${item.name}:${item.tai} 台`;
        list.appendChild(li);
      }
      box.appendChild(list);
    }
    container.appendChild(box);
  }

  // 遊戲結束(自摸/胡牌/流局)後攤開四家的手牌,方便對照剛剛的牌局;
  // 如果是點炮胡牌,贏家那家的手牌右邊會多顯示放槍的那張牌
  function renderRevealedHands(container) {
    const heading = document.createElement('h3');
    heading.textContent = '攤牌';
    container.appendChild(heading);

    for (let seat = 0; seat < game.players.length; seat++) {
      const player = game.players[seat];
      const label = document.createElement('p');
      label.className = 'hint';
      label.textContent = `${seatLabel(seat)}:`;
      container.appendChild(label);
      const winningTile = game.result.type === 'ron' && seat === game.result.winnerSeat ? game.result.tile : null;
      appendHandWithMelds(container, renderTileRow(sortTiles(player.hand)), player, winningTile);
    }
  }

  return {
    mount(el) {
      container = el;
      if (!game) newGame(); // newGame() 自己會走到 render(),不要在這裡又呼叫一次 render() 造成重複畫面
      else render();
    },
  };
}
