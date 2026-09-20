// 麻將實戰(v1):真人 vs 3 位固定人設 AI 的正式對局 —— 有籌碼、有莊家輪替、有戰績紀錄。
// 呈現方式完全比照人機對局(綠色桌布、頭像、閃爍棄牌、吃碰槓按鈕),但拿掉所有效率分析/
// 提示/悔牌:選牌後直接打出去,沒有「這是不是最佳解」的講解,略過也是直接略過,錯了就是錯了。
//
// 座位規則:引擎(src/game.js)本身假設「座位 0 = 莊家」,所以每一手開局時,
// 由目前的莊家身分佔據座位 0,其餘 3 人依固定的相對順序輪流填入座位 1~3 ——
// 這樣一來,真人不一定每手都坐在座位 0,莊家輪替時真人自己也可能當莊或轉閒家。
//
// 結算規則(已知簡化,底 300、台 100):
// - 自摸:莊家自摸每家付 2 倍,閒家自摸則莊家付 2 倍、其餘閒家付 1 倍,贏家收三家的錢。
// - 胡牌(點炮):贏家或放槍者只要有一方是莊家就付 2 倍,否則 1 倍,只有放槍者付錢。
// - 流局不轉籌碼(不計算聽牌/不聽罰符)。
// 莊家輪替:莊家自己胡牌(自摸或胡到別人放槍)或流局都連莊,否則輪到下一位。
// 比賽結束時機:任何一家籌碼歸零自動結束,或玩家自己按「結束比賽」。

import { tileCode, tileFromCode, tileDisplayName, sortTiles } from '../src/tiles.js';
import { calculateShanten } from '../src/shanten.js';
import {
  createGame,
  drawForCurrentPlayer,
  chooseAiDiscard,
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

const AI_DISCARD_PAUSE_MS = 1000; // AI 出牌後,沒人需要決定的話閃爍 1 秒就換下一家(比人機對局的 2 秒快)
const STARTING_CHIPS = 25000;
const BASE_POINT = 300; // 底
const TAI_POINT = 100; // 台
const TENPAI_BONUS_TAI = 1; // 叫聽:贏的時候多算的台數
const STATS_KEY = 'majhongMatchStatsV1';
const MELD_LABEL = { pon: '碰', chi: '吃', ankan: '暗槓', minkan: '槓' };

const ROUND_WIND_NAMES = ['東', '南', '西', '北'];

const AI_ROSTER = [
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

function describeCallOption(option) {
  if (option.type === 'pon') return '碰';
  if (option.type === 'kan') return '槓';
  return `吃(${option.otherRanks.slice().sort((a, b) => a - b).join('、')})`;
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 私密瀏覽模式等情況下讀不到就當作沒有紀錄 */
  }
  return {};
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* 存不進去就算了,不影響對局 */
  }
}

// 從伺服器端的資料庫檔案讀取戰績。部署在 GitHub Pages 等純靜態環境時沒有這支 API,
// fetch 會失敗,這時就安靜地放棄,繼續用 localStorage 的資料。
async function fetchServerStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

// 同時寫本機 localStorage(立即生效、離線也能用)和伺服器資料庫檔案(跨裝置持久保存)。
// 伺服器寫入失敗(例如純靜態部署)就當作沒這回事,不影響對局進行。
function persistStats(stats) {
  saveStats(stats);
  fetch('/api/stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stats),
  }).catch(() => {});
}

function emptyPlayerStats() {
  return { matchesPlayed: 0, matchesWon: 0, winCount: 0, tsumoCount: 0, dealInCount: 0 };
}

export function createMatchController({ renderTileRow, onActiveChange }) {
  let container = null;
  let stats = loadStats();

  // ---- 場次層:姓名、籌碼、莊家輪替 ----
  let phase = 'setup'; // 'setup' | 'hand' | 'handEnd' | 'matchEnd'
  let playerName = '';
  let identities = null; // 固定順序 4 人,index 0 永遠是真人;莊家輪替只改變「誰坐在座位0」,不改變這個順序
  let chips = null; // 對應 identities 的索引
  let dealerIdentityIndex = 0; // 這一手實際在打的莊家,座位配置(identityOfSeat)都以這個為準
  let pendingDealerIdentityIndex = null; // 這一手結束後算出的下一手莊家,startNewHand() 開新的一手時才套用
  let totalRounds = 1; // 開局前選的圈數:1=東風圈,2=東南,3=東南西,4=東南西北
  let roundWindIndex = 0; // 目前第幾圈(0=東 1=南 2=西 3=北)
  let handInRoundIndex = 0; // 這一圈第幾局(0=東局 1=南局 2=西局 3=北局)
  let repeatCount = 1; // 目前這一局連莊第幾次(第一次打是 1,連莊一次變 2...)
  let pendingRoundState = null; // 這一手結束後算出的下一手圈/局/連莊,startNewHand() 才套用
  let matchShouldEndAfterThisHand = false; // 這一手打完,選的圈數已經打滿了,下一步是結束比賽

  // ---- 單手牌層 ----
  let game = null;
  let pendingDrewCode = null;
  let pendingCanWin = false;
  let pendingIsRinshan = false;
  let pendingCallPrompt = null;
  let pendingRonPrompt = null;
  let pendingChankanPrompt = null;
  let pendingDiscardChoice = null;
  let lastDiscard = null;
  let lastSettlement = null;
  let settlementApplied = false;
  let tenpaiDeclared = [false, false, false, false]; // 這一手每家有沒有叫聽,索引是座位

  // 這家現在的手牌(16 張,不含還沒打出的摸牌)是不是聽牌
  function isHandTenpai(player) {
    return player.hand.length % 3 === 1 && calculateShanten(player.hand, player.melds.length) === 0;
  }

  function humanSeat() {
    return game.players.findIndex((p) => p.isHuman);
  }
  function identityOfSeat(seat) {
    return (seat + dealerIdentityIndex) % 4;
  }
  function identityAt(seat) {
    return identities[identityOfSeat(seat)];
  }
  function positionLabel(seat) {
    const rel = (seat - humanSeat() + 4) % 4;
    return ['你', '下家', '對面', '上家'][rel];
  }
  function seatLabel(seat) {
    const identity = identityAt(seat);
    return identity.isHuman ? '你' : `${identity.name}(${positionLabel(seat)})`;
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

  // 目前打到第幾圈第幾局,例如「東風東局」,連莊的話後面加註「N連莊」
  function roundProgressText() {
    const roundName = ROUND_WIND_NAMES[roundWindIndex] ?? ROUND_WIND_NAMES[ROUND_WIND_NAMES.length - 1];
    const handName = ROUND_WIND_NAMES[handInRoundIndex];
    const repeatSuffix = repeatCount > 1 ? ` ${repeatCount}連莊` : '';
    return `${roundName}風${handName}局${repeatSuffix}`;
  }

  function startNewMatch() {
    identities = [
      { isHuman: true, name: playerName },
      ...shuffled(AI_ROSTER).map((p) => ({ isHuman: false, name: p.name, avatar: p.avatar })),
    ];
    chips = [STARTING_CHIPS, STARTING_CHIPS, STARTING_CHIPS, STARTING_CHIPS];
    dealerIdentityIndex = 0; // 第一手固定自己坐莊,比較符合「輸入姓名就開始」的直覺
    pendingDealerIdentityIndex = null;
    roundWindIndex = 0;
    handInRoundIndex = 0;
    repeatCount = 1;
    pendingRoundState = null;
    matchShouldEndAfterThisHand = false;
    startNewHand();
  }

  function startNewHand() {
    if (pendingDealerIdentityIndex !== null) {
      dealerIdentityIndex = pendingDealerIdentityIndex;
      pendingDealerIdentityIndex = null;
    }
    if (pendingRoundState !== null) {
      roundWindIndex = pendingRoundState.roundWindIndex;
      handInRoundIndex = pendingRoundState.handInRoundIndex;
      repeatCount = pendingRoundState.repeatCount;
      pendingRoundState = null;
    }
    const configs = [];
    for (let seat = 0; seat < 4; seat++) {
      const identity = identities[identityOfSeat(seat)];
      configs.push({ isHuman: identity.isHuman });
    }
    game = createGame(configs, { includeFlowers: true });
    pendingDrewCode = null;
    pendingCanWin = false;
    pendingIsRinshan = false;
    pendingCallPrompt = null;
    pendingRonPrompt = null;
    pendingChankanPrompt = null;
    pendingDiscardChoice = null;
    lastDiscard = null;
    lastSettlement = null;
    settlementApplied = false;
    tenpaiDeclared = [false, false, false, false];
    phase = 'hand';
    advanceUntilHumanOrEnd();
  }

  function baseAmount(score) {
    return BASE_POINT + score.total * TAI_POINT;
  }

  // 一手結束後結算籌碼、記錄戰績、決定下一手莊家,只會真正執行一次(render() 可能被呼叫很多次)
  function settleHand() {
    if (settlementApplied || !game.finished) return;
    settlementApplied = true;

    const result = game.result;
    const deltas = identities.map((identity) => ({ name: identity.name, isHuman: identity.isHuman, delta: 0 }));
    let winnerIdentityIndex = null;
    let humanEventType = null; // 'tsumo' | 'ron_win' | 'dealt_in' | null
    let tenpaiBonusTai = 0;
    let dealerBonusTai = 0;
    let totalTaiWithBonus = null;

    if (result.type === 'tsumo') {
      const winnerSeat = result.seat;
      const winnerIsDealer = winnerSeat === 0;
      // 天胡/地胡本身已經直接視為總台數,不跟莊家台疊加(見 src/scoring.js)
      const isLimitHand = result.score.items.some((item) => item.key === 'tianHu' || item.key === 'diHu');
      tenpaiBonusTai = tenpaiDeclared[winnerSeat] ? TENPAI_BONUS_TAI : 0;
      // 莊家台:新莊 1 台,每連莊一次 +2 台(莊連1=3台、莊連2=5台...),只有莊家自己胡牌才算
      dealerBonusTai = winnerIsDealer && !isLimitHand ? repeatCount * 2 - 1 : 0;
      totalTaiWithBonus = result.score.total + tenpaiBonusTai + dealerBonusTai;
      const amount = baseAmount({ total: totalTaiWithBonus });
      winnerIdentityIndex = identityOfSeat(winnerSeat);
      let totalGain = 0;
      for (let seat = 0; seat < 4; seat++) {
        if (seat === winnerSeat) continue;
        const loserIsDealer = seat === 0;
        const pay = amount * (winnerIsDealer || loserIsDealer ? 2 : 1);
        deltas[identityOfSeat(seat)].delta -= pay;
        totalGain += pay;
      }
      deltas[winnerIdentityIndex].delta += totalGain;
      if (identities[winnerIdentityIndex].isHuman) humanEventType = 'tsumo';
    } else if (result.type === 'ron') {
      const { winnerSeat, discarderSeat } = result;
      const winnerIsDealer = winnerSeat === 0;
      // 天胡/地胡只會發生在自摸,點炮不會有這兩項,但還是統一判斷避免以後邏輯改動時漏掉
      const isLimitHand = result.score.items.some((item) => item.key === 'tianHu' || item.key === 'diHu');
      tenpaiBonusTai = tenpaiDeclared[winnerSeat] ? TENPAI_BONUS_TAI : 0;
      // 莊家台:新莊 1 台,每連莊一次 +2 台(莊連1=3台、莊連2=5台...),只有莊家自己胡牌才算
      dealerBonusTai = winnerIsDealer && !isLimitHand ? repeatCount * 2 - 1 : 0;
      totalTaiWithBonus = result.score.total + tenpaiBonusTai + dealerBonusTai;
      const amount = baseAmount({ total: totalTaiWithBonus });
      const discarderIsDealer = discarderSeat === 0;
      const pay = amount * (winnerIsDealer || discarderIsDealer ? 2 : 1);
      winnerIdentityIndex = identityOfSeat(winnerSeat);
      const discarderIdentityIndex = identityOfSeat(discarderSeat);
      deltas[discarderIdentityIndex].delta -= pay;
      deltas[winnerIdentityIndex].delta += pay;
      if (identities[winnerIdentityIndex].isHuman) humanEventType = 'ron_win';
      else if (identities[discarderIdentityIndex].isHuman) humanEventType = 'dealt_in';
    }
    // 流局(result.type === 'draw'):不轉籌碼,見檔頭已知簡化說明

    deltas.forEach((d, idx) => {
      chips[idx] += d.delta;
      d.newTotal = chips[idx];
    });
    lastSettlement = { resultType: result.type, deltas, tenpaiBonusTai, dealerBonusTai, totalTaiWithBonus };

    if (playerName) {
      const s = stats[playerName] ?? emptyPlayerStats();
      if (humanEventType === 'tsumo') s.tsumoCount += 1;
      if (humanEventType === 'tsumo' || humanEventType === 'ron_win') s.winCount += 1;
      if (humanEventType === 'dealt_in') s.dealInCount += 1;
      stats[playerName] = s;
      persistStats(stats);
    }

    // 這裡先算出「下一手」的莊家/圈局,但不馬上套用 —— 這一手的結算畫面(chip bar/座位/進度)
    // 還要繼續顯示「剛剛那一手」的狀態,不然結算文字會跟畫面對不起來。
    // 真的換莊、換局要等玩家按「下一手」、startNewHand() 真正開新的一手時才生效。
    const dealerWon = winnerIdentityIndex === dealerIdentityIndex;
    if (result.type !== 'draw' && !dealerWon) {
      pendingDealerIdentityIndex = (dealerIdentityIndex + 1) % 4;
      let nextHandInRound = handInRoundIndex + 1;
      let nextRoundWind = roundWindIndex;
      if (nextHandInRound >= 4) {
        nextHandInRound = 0;
        nextRoundWind += 1;
      }
      pendingRoundState = { roundWindIndex: nextRoundWind, handInRoundIndex: nextHandInRound, repeatCount: 1 };
    } else {
      // 莊家胡牌或流局都連莊:圈/局不變,連莊次數 +1
      pendingDealerIdentityIndex = dealerIdentityIndex;
      pendingRoundState = { roundWindIndex, handInRoundIndex, repeatCount: repeatCount + 1 };
    }
    matchShouldEndAfterThisHand = pendingRoundState.roundWindIndex >= totalRounds;

    phase = 'handEnd';
  }

  function endMatch() {
    if (playerName) {
      const s = stats[playerName] ?? emptyPlayerStats();
      s.matchesPlayed += 1;
      if (chips[0] > STARTING_CHIPS) s.matchesWon += 1;
      stats[playerName] = s;
      persistStats(stats);
    }
    phase = 'matchEnd';
    render();
  }

  // ---- 以下單手牌流程跟人機對局(play.js)幾乎相同,差別只在座位不再假設「0 = 真人」 ----

  function processCallGroups(groups, index, discarderSeat, tile) {
    if (index >= groups.length) {
      skipCall(game, discarderSeat);
      return true;
    }
    const group = groups[index];
    const player = game.players[group.seat];

    if (player.isHuman) {
      pendingCallPrompt = { discarderSeat, tile, groups, index, group };
      return false;
    }

    const decision = chooseAiCallDecision(player, group, tile);
    if (decision) {
      if (decision.type === 'pon') {
        applyPon(game, group.seat, discarderSeat, tile);
      } else if (decision.type === 'kan') {
        const { canWin } = applyMinkan(game, group.seat, discarderSeat, tile);
        if (canWin) declareTsumo(game, { isRinshan: true });
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

  function resolveDiscardAftermath(discarderSeat, tile) {
    const ronSeat = findRonOpportunity(game, discarderSeat, tile);
    if (ronSeat !== null) {
      const player = game.players[ronSeat];
      if (player.isHuman) {
        pendingRonPrompt = { discarderSeat, tile, ronSeat };
        return false;
      }
      applyRon(game, ronSeat, discarderSeat, tile);
      return true;
    }
    return resolveCallOpportunities(discarderSeat, tile);
  }

  function performAiKanIfPossible(player) {
    for (;;) {
      const ankanCode = findAnkanOptions(player)[0];
      if (ankanCode) {
        const { drewTile, canWin } = applyAnkan(game, player.seat, ankanCode);
        if (!drewTile) return true;
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

  function performAiDiscardStep(seat) {
    const player = game.players[seat];
    const discardCode = chooseAiDiscard(player, game);
    const tile = discard(game, discardCode);
    lastDiscard = { seat, code: discardCode };
    // AI 一律貪心宣告:打完這張牌如果聽牌了,馬上叫聽(不像真人可以自己選擇要不要叫)
    if (!tenpaiDeclared[seat] && isHandTenpai(player)) tenpaiDeclared[seat] = true;
    render();

    const resolved = resolveDiscardAftermath(seat, tile);
    render();
    if (!resolved || game.finished) return;

    setTimeout(() => advanceUntilHumanOrEnd(), AI_DISCARD_PAUSE_MS);
  }

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
        lastDiscard = null;
        render();
        return;
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
      return;
    }

    if (canWin) {
      declareTsumo(game);
      render();
      return;
    }

    const kanResult = performAiKanIfPossible(player);
    if (kanResult === 'paused') {
      render();
      return;
    }
    if (game.finished) {
      render();
      return;
    }

    performAiDiscardStep(seat);
  }

  function selectDiscardCandidate(code) {
    pendingDiscardChoice = code;
    render();
  }

  // 在手牌上點兩下(或連續快速點兩下)直接打出那張牌,不用再按一次確認鈕
  function discardTileDirectly(code) {
    pendingDiscardChoice = code;
    confirmDiscardCandidate();
  }

  // 真人自己選擇要不要叫聽(聽牌狀態下才看得到這顆按鈕),叫聽之後贏的話多算一台
  function declareTenpai() {
    const mySeat = humanSeat();
    if (tenpaiDeclared[mySeat] || !isHandTenpai(game.players[mySeat])) return;
    tenpaiDeclared[mySeat] = true;
    render();
  }

  // 沒有分析、沒有悔牌 —— 選了牌按確認就直接打出去
  function confirmDiscardCandidate() {
    if (!pendingDiscardChoice) return;
    const code = pendingDiscardChoice;
    pendingDiscardChoice = null;
    const discarderSeat = humanSeat();
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
    const mySeat = humanSeat();
    const result = applyAnkan(game, mySeat, code);
    pendingDrewCode = result.drewTile ? tileCode(result.drewTile) : null;
    pendingCanWin = result.canWin;
    pendingIsRinshan = true;
    pendingDiscardChoice = null;
    render();
  }

  function humanDeclareKakan(code) {
    const mySeat = humanSeat();
    const tile = beginKakan(game, mySeat, code);
    const robberSeat = findChankanOpportunity(game, mySeat, tile);
    if (robberSeat !== null) {
      applyChankan(game, robberSeat, mySeat, tile); // 搶自己的槓只會是 AI,一律直接接受
      render();
      return;
    }
    const result = finalizeKakan(game, mySeat, tile);
    pendingDrewCode = result.drewTile ? tileCode(result.drewTile) : null;
    pendingCanWin = result.canWin;
    pendingIsRinshan = true;
    pendingDiscardChoice = null;
    render();
  }

  function humanCallChoice(choice) {
    if (!pendingCallPrompt) return;
    const { discarderSeat, tile, groups, index } = pendingCallPrompt;
    pendingCallPrompt = null;
    const mySeat = humanSeat();

    if (choice === 'pass') {
      if (processCallGroups(groups, index + 1, discarderSeat, tile)) advanceUntilHumanOrEnd();
      render();
      return;
    }

    if (choice.type === 'pon') {
      applyPon(game, mySeat, discarderSeat, tile);
      advanceUntilHumanOrEnd();
      render();
      return;
    }

    if (choice.type === 'kan') {
      const result = applyMinkan(game, mySeat, discarderSeat, tile);
      pendingDrewCode = result.drewTile ? tileCode(result.drewTile) : null;
      pendingCanWin = result.canWin;
      pendingIsRinshan = true;
      render();
      return;
    }

    applyChi(game, mySeat, discarderSeat, tile, choice.otherRanks);
    advanceUntilHumanOrEnd();
    render();
  }

  function humanChankanChoice(accept) {
    if (!pendingChankanPrompt) return;
    const { kanSeat, tile } = pendingChankanPrompt;
    pendingChankanPrompt = null;
    const mySeat = humanSeat();

    if (accept) {
      applyChankan(game, mySeat, kanSeat, tile);
      render();
      return;
    }

    const result = finalizeKakan(game, kanSeat, tile);
    if (result.drewTile && result.canWin) {
      declareTsumo(game, { isRinshan: true });
    }
    if (!game.finished) advanceUntilHumanOrEnd();
    render();
  }

  function humanRonChoice(accept) {
    if (!pendingRonPrompt) return;
    const { discarderSeat, tile } = pendingRonPrompt;
    pendingRonPrompt = null;
    const mySeat = humanSeat();

    let resolved;
    if (accept) {
      applyRon(game, mySeat, discarderSeat, tile);
      resolved = true;
    } else {
      markFuriten(game.players[mySeat]); // 點炮不胡,過水:整組聽牌都不能胡,直到自己下一次打牌才解除
      resolved = resolveCallOpportunities(discarderSeat, tile);
    }

    if (resolved) advanceUntilHumanOrEnd();
    render();
  }

  // ---- 畫面 ----

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

  // 花牌只是攤開展示,不算面子,水平排一列放在面子右邊(跟自己的面子同一種排法)
  function buildFlowersBlock(player) {
    if (player.flowers.length === 0) return null;
    const block = document.createElement('div');
    block.className = 'seat-melds-block melds-horizontal flowers-block';
    block.appendChild(renderTileRow(sortTiles(player.flowers), { small: true }));
    return block;
  }

  function buildYourHandRow(handRowEl, confirmBtnEl, player) {
    const handWrap = document.createElement('div');
    handWrap.className = 'hand-with-melds';
    handWrap.appendChild(handRowEl);
    if (confirmBtnEl) handWrap.appendChild(confirmBtnEl);

    const isWinner = winningSeat() === player.seat;
    const hasDiscards = player.discards.length > 0;
    const hasMelds = player.melds.length > 0;
    const flowersBlock = buildFlowersBlock(player);
    const hasFlowers = !!flowersBlock;
    if (!hasDiscards && !hasMelds && !hasFlowers) {
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

    // 自己吃碰槓的面子、摸到的花牌也放在手牌上方,但靠右(跟置中的打出牌分開,不會擠在一起)
    if (hasMelds || hasFlowers) {
      const extrasRow = document.createElement('div');
      extrasRow.className = 'your-extras-row';
      if (hasMelds) {
        const meldsBlock = document.createElement('div');
        meldsBlock.className = 'seat-melds-block melds-horizontal';
        renderMelds(meldsBlock, player, { small: true, showLabel: false });
        extrasRow.appendChild(meldsBlock);
      }
      if (hasFlowers) extrasRow.appendChild(flowersBlock);
      column.appendChild(extrasRow);
    }

    column.appendChild(handWrap);
    return column;
  }

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
      meldsBlock.className = 'seat-melds-block melds-horizontal';
      renderMelds(meldsBlock, player, { small: true, showLabel: false });
      wrap.appendChild(meldsBlock);
    }
    const flowersBlock = buildFlowersBlock(player);
    if (flowersBlock) wrap.appendChild(flowersBlock);
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
    const identity = identityAt(seat);
    const card = document.createElement('div');
    card.className = seat === 0 ? 'seat-card seat-dealer' : 'seat-card';
    if (winningSeat() === seat) card.appendChild(buildWinBadge());

    const header = document.createElement('div');
    header.className = 'seat-header';

    const avatar = document.createElement('div');
    avatar.className = 'seat-avatar';
    const avatarImg = document.createElement('img');
    avatarImg.src = identity.avatar;
    avatarImg.alt = identity.name;
    avatar.appendChild(avatarImg);
    header.appendChild(avatar);

    const nameBlock = document.createElement('div');
    nameBlock.className = 'seat-name-block';
    const nameEl = document.createElement('div');
    nameEl.className = 'seat-name';
    nameEl.textContent = identity.name;
    if (seat === 0) {
      const badge = document.createElement('span');
      badge.className = 'dealer-badge';
      badge.textContent = repeatCount > 1 ? `莊${repeatCount}` : '莊'; // 連莊的話標出目前連莊第幾把
      nameEl.appendChild(badge);
    }
    nameBlock.appendChild(nameEl);

    const meta = document.createElement('div');
    meta.className = 'seat-meta';
    meta.textContent = `${positionLabel(seat)}・籌碼 ${chips[identityOfSeat(seat)]}・手牌 ${
      player.hand.length
    } 張・棄牌 ${player.discards.length} 張${
      player.melds.length > 0 ? `・吃碰槓 ${player.melds.length} 組` : ''
    }${player.flowers.length > 0 ? `・花 ${player.flowers.length} 張` : ''}`;
    nameBlock.appendChild(meta);
    header.appendChild(nameBlock);
    card.appendChild(header);

    if (player.discards.length > 0) {
      const discardRow = renderTileRow(player.discards, { small: true });

      if (lastDiscard && lastDiscard.seat === seat) {
        const lastTileBtn = discardRow.lastElementChild;
        if (lastTileBtn) lastTileBtn.classList.add('tile-blink');
      }

      if (pendingCallPrompt && pendingCallPrompt.discarderSeat === seat) {
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
    passBtn.addEventListener('click', () => humanCallChoice('pass')); // 沒有分析預覽,直接略過
    btnRow.appendChild(passBtn);
    return btnRow;
  }

  function buildMeldsBlock(seat) {
    const player = game.players[seat];
    const block = document.createElement('div');
    // 橫向排、空間不夠自動換行,不要一組疊一行往下長,牌桌高度才不會隨吃碰次數暴衝;
    // 不顯示「碰/吃/槓」文字標籤,牌組本身的花色排列就看得出叫的是什麼,可以再省一行高度
    block.className = 'seat-melds-block melds-horizontal';
    renderMelds(block, player, { small: true, showLabel: false });
    return block;
  }

  function renderCallPrompt(container) {
    const { discarderSeat, tile } = pendingCallPrompt;
    const label = document.createElement('p');
    label.className = 'hint';
    label.textContent = `${seatLabel(discarderSeat)} 打出「${tileDisplayName(
      tile
    )}」,你要吃碰嗎?在牌桌上閃爍的那張牌旁邊選擇。`;
    container.appendChild(label);
  }

  function buildTable(topSeat, leftSeat, rightSeat, bottomContentEl) {
    const table = document.createElement('div');
    table.className = 'mahjong-table';

    const progress = document.createElement('div');
    progress.className = 'round-progress';
    progress.textContent = roundProgressText();
    table.appendChild(progress);

    table.appendChild(buildWallIndicator());

    const topRow = document.createElement('div');
    topRow.className = 'seat-row-top';
    const topGroup = document.createElement('div');
    topGroup.className = 'seat-with-melds-below';
    topGroup.appendChild(buildSeatCard(topSeat));
    topGroup.appendChild(buildMeldsBlock(topSeat));
    topRow.appendChild(topGroup);
    table.appendChild(topRow);

    const middleRow = document.createElement('div');
    middleRow.className = 'seat-row-middle';

    const upperGroup = document.createElement('div');
    upperGroup.className = 'seat-with-melds-above';
    upperGroup.appendChild(buildMeldsBlock(leftSeat));
    upperGroup.appendChild(buildSeatCard(leftSeat));
    middleRow.appendChild(upperGroup);

    const lowerGroup = document.createElement('div');
    lowerGroup.className = 'seat-with-melds-above';
    lowerGroup.appendChild(buildMeldsBlock(rightSeat));
    lowerGroup.appendChild(buildSeatCard(rightSeat));
    middleRow.appendChild(lowerGroup);

    table.appendChild(middleRow);

    if (bottomContentEl) {
      const bottomRow = document.createElement('div');
      bottomRow.className = 'seat-row-bottom';
      bottomRow.appendChild(bottomContentEl);
      table.appendChild(bottomRow);
    }

    return table;
  }

  function renderResult(container) {
    if (game.result.type === 'tsumo') {
      const announce = document.createElement('div');
      announce.className = 'win-announce';
      const title = document.createElement('div');
      title.className = 'win-title';
      title.textContent = '自摸';
      announce.appendChild(title);
      container.appendChild(announce);
    } else if (game.result.type === 'ron') {
      const announce = document.createElement('div');
      announce.className = 'win-announce';
      const title = document.createElement('div');
      title.className = 'win-title';
      title.textContent = '胡牌';
      announce.appendChild(title);
      container.appendChild(announce);
    } else {
      const announce = document.createElement('div');
      announce.className = 'win-announce';
      const title = document.createElement('div');
      title.className = 'win-title';
      title.textContent = '流局';
      announce.appendChild(title);
      container.appendChild(announce);
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
      const displayTotal = lastSettlement?.totalTaiWithBonus ?? game.result.score.total;
      const p = document.createElement('p');
      p.className = identityAt(seat).isHuman ? 'verdict correct' : 'verdict wrong';
      p.textContent = `${seatLabel(seat)} 自摸胡牌,總共 ${displayTotal} 台`;
      box.appendChild(p);
      const list = document.createElement('ul');
      for (const item of game.result.score.items) {
        const li = document.createElement('li');
        li.textContent = `${item.name}:${item.tai} 台`;
        list.appendChild(li);
      }
      if (lastSettlement?.tenpaiBonusTai > 0) {
        const li = document.createElement('li');
        li.textContent = `叫聽:${lastSettlement.tenpaiBonusTai} 台`;
        list.appendChild(li);
      }
      if (lastSettlement?.dealerBonusTai > 0) {
        const li = document.createElement('li');
        li.textContent = `莊家台:${lastSettlement.dealerBonusTai} 台`;
        list.appendChild(li);
      }
      box.appendChild(list);
    } else if (game.result.type === 'ron') {
      const { winnerSeat, discarderSeat } = game.result;
      const displayTotal = lastSettlement?.totalTaiWithBonus ?? game.result.score.total;
      const p = document.createElement('p');
      p.className = identityAt(winnerSeat).isHuman ? 'verdict correct' : 'verdict wrong';
      p.textContent = `${seatLabel(discarderSeat)}放槍,${seatLabel(winnerSeat)}胡牌!總共 ${displayTotal} 台`;
      box.appendChild(p);
      const list = document.createElement('ul');
      for (const item of game.result.score.items) {
        const li = document.createElement('li');
        li.textContent = `${item.name}:${item.tai} 台`;
        list.appendChild(li);
      }
      if (lastSettlement?.tenpaiBonusTai > 0) {
        const li = document.createElement('li');
        li.textContent = `叫聽:${lastSettlement.tenpaiBonusTai} 台`;
        list.appendChild(li);
      }
      if (lastSettlement?.dealerBonusTai > 0) {
        const li = document.createElement('li');
        li.textContent = `莊家台:${lastSettlement.dealerBonusTai} 台`;
        list.appendChild(li);
      }
      box.appendChild(list);
    }
    container.appendChild(box);

    if (lastSettlement) {
      const deltaBox = document.createElement('div');
      deltaBox.className = 'feedback';
      const heading = document.createElement('p');
      heading.textContent = '本手籌碼異動:';
      deltaBox.appendChild(heading);
      const list = document.createElement('ul');
      for (const d of lastSettlement.deltas) {
        const li = document.createElement('li');
        const sign = d.delta > 0 ? '+' : '';
        li.textContent = `${d.isHuman ? '你・' : ''}${d.name}:${sign}${d.delta}(現有 ${d.newTotal})`;
        list.appendChild(li);
      }
      deltaBox.appendChild(list);
      container.appendChild(deltaBox);
    }
  }

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

  function renderHandEndActions(container) {
    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons';
    const bankrupt = chips.some((c) => c <= 0);
    if (bankrupt || matchShouldEndAfterThisHand) {
      const p = document.createElement('p');
      p.className = 'verdict wrong';
      p.textContent = bankrupt ? '有人籌碼歸零了,本場比賽結束。' : `已經打完選擇的 ${totalRounds} 圈,本場比賽結束。`;
      container.appendChild(p);
      const endBtn = document.createElement('button');
      endBtn.type = 'button';
      endBtn.className = 'action-btn';
      endBtn.textContent = '查看本場戰績';
      endBtn.addEventListener('click', endMatch);
      btnRow.appendChild(endBtn);
    } else {
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'action-btn';
      nextBtn.textContent = '下一手';
      nextBtn.addEventListener('click', startNewHand);
      btnRow.appendChild(nextBtn);

      const stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'action-btn action-btn-pass';
      stopBtn.textContent = '結束比賽';
      stopBtn.addEventListener('click', endMatch);
      btnRow.appendChild(stopBtn);
    }
    container.appendChild(btnRow);
  }

  function renderStatsTable(container, highlightName, { onSelectName, onDeleteName } = {}) {
    const names = Object.keys(stats);
    if (names.length === 0) return;
    const heading = document.createElement('h3');
    heading.textContent = '戰績紀錄';
    container.appendChild(heading);

    if (onSelectName) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '點一列可以帶入姓名、繼續累積該選手的戰績。';
      container.appendChild(hint);
    }

    const table = document.createElement('table');
    table.className = 'match-stats-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headers = ['姓名', '完賽場數', '勝率', '胡牌數', '自摸數', '放槍數'];
    if (onDeleteName) headers.push('');
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const name of names) {
      const s = stats[name];
      const rate = s.matchesPlayed > 0 ? Math.round((s.matchesWon / s.matchesPlayed) * 100) : 0;
      const tr = document.createElement('tr');
      tr.className = (name === highlightName ? 'highlight-row' : '') + (onSelectName ? ' stats-row' : '');
      if (onSelectName) tr.addEventListener('click', () => onSelectName(name));
      const cells = [name, String(s.matchesPlayed), `${rate}%`, String(s.winCount), String(s.tsumoCount), String(s.dealInCount)];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      if (onDeleteName) {
        const actionTd = document.createElement('td');
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'stats-delete-btn';
        deleteBtn.textContent = '刪除';
        deleteBtn.addEventListener('click', (event) => {
          event.stopPropagation(); // 不要連帶觸發那一列的「帶入姓名」
          if (window.confirm(`確定要刪除「${name}」的戰績紀錄嗎?這個動作無法復原。`)) {
            onDeleteName(name);
          }
        });
        actionTd.appendChild(deleteBtn);
        tr.appendChild(actionTd);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderSetup(container) {
    const title = document.createElement('h2');
    title.textContent = '麻將實戰';
    container.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'description';
    desc.textContent =
      '真人對 3 位 AI 的正式對局:每人起始籌碼 25000,底 300、台 100,沒有任何提示或悔牌 —— 輸入姓名開始比賽。';
    container.appendChild(desc);

    const roundsLabel = document.createElement('p');
    roundsLabel.className = 'hint';
    roundsLabel.textContent = '選擇打幾圈:';
    container.appendChild(roundsLabel);

    const roundsRow = document.createElement('div');
    roundsRow.className = 'action-buttons';
    const ROUND_CHOICES = [
      { rounds: 1, label: '東風圈(1圈)' },
      { rounds: 2, label: '東南風圈(2圈)' },
      { rounds: 3, label: '東南西風圈(3圈)' },
      { rounds: 4, label: '東南西北風圈(4圈)' },
    ];
    for (const choice of ROUND_CHOICES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn action-btn-secondary' + (totalRounds === choice.rounds ? ' rounds-choice-active' : '');
      btn.textContent = choice.label;
      btn.addEventListener('click', () => {
        totalRounds = choice.rounds;
        render();
      });
      roundsRow.appendChild(btn);
    }
    container.appendChild(roundsRow);

    const form = document.createElement('div');
    form.className = 'action-buttons';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '輸入你的姓名';
    input.value = playerName;
    input.className = 'name-input';
    form.appendChild(input);

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'action-btn';
    startBtn.textContent = '開始比賽';
    startBtn.disabled = !input.value.trim();
    input.addEventListener('input', () => {
      startBtn.disabled = !input.value.trim();
    });
    startBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) return;
      playerName = name;
      startNewMatch();
    });
    form.appendChild(startBtn);
    container.appendChild(form);

    renderStatsTable(container, playerName, {
      onSelectName: (name) => {
        input.value = name;
        startBtn.disabled = !name.trim();
        input.focus();
      },
      onDeleteName: (name) => {
        delete stats[name];
        persistStats(stats);
        render();
      },
    });
  }

  function renderMatchSummary(container) {
    const title = document.createElement('h2');
    title.textContent = '比賽結束';
    container.appendChild(title);

    const standings = identities
      .map((identity, idx) => ({ name: identity.name, isHuman: identity.isHuman, chips: chips[idx] }))
      .sort((a, b) => b.chips - a.chips);
    const list = document.createElement('ol');
    for (const s of standings) {
      const li = document.createElement('li');
      li.textContent = `${s.isHuman ? `你・${s.name}` : s.name}:${s.chips} 籌碼`;
      if (s.isHuman) li.className = 'verdict correct';
      list.appendChild(li);
    }
    container.appendChild(list);

    renderStatsTable(container, playerName);

    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons';
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'action-btn';
    again.textContent = '再玩一場(同樣的姓名)';
    again.addEventListener('click', () => startNewMatch());
    btnRow.appendChild(again);

    const changeName = document.createElement('button');
    changeName.type = 'button';
    changeName.className = 'action-btn action-btn-pass';
    changeName.textContent = '換人,重新輸入姓名';
    changeName.addEventListener('click', () => {
      playerName = '';
      phase = 'setup';
      render();
    });
    btnRow.appendChild(changeName);
    container.appendChild(btnRow);
  }

  function renderTable(container) {
    settleHand();

    const h = humanSeat();
    const you = game.players[h];
    const rightSeat = (h + 1) % 4;
    const topSeat = (h + 2) % 4;
    const leftSeat = (h + 3) % 4;

    const isNormalTurn =
      phase === 'hand' &&
      game.currentSeat === h &&
      !game.finished &&
      !pendingRonPrompt &&
      !pendingCallPrompt &&
      !pendingChankanPrompt;

    let handRowEl;
    if (isNormalTurn) {
      handRowEl = renderTileRow(sortTiles(you.hand), {
        onClick: (code) => selectDiscardCandidate(code),
        onDoubleClick: (code) => discardTileDirectly(code),
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
      confirmBtnEl.textContent = '打出';
      confirmBtnEl.disabled = !pendingDiscardChoice;
      confirmBtnEl.addEventListener('click', confirmDiscardCandidate);
    } else if (!game.finished && !tenpaiDeclared[h] && isHandTenpai(you)) {
      // 手牌穩定在聽牌狀態(剛打完牌、還沒輪到自己摸下一張)才能叫聽,自己選擇要不要叫
      confirmBtnEl = document.createElement('button');
      confirmBtnEl.type = 'button';
      confirmBtnEl.className = 'action-btn action-btn-secondary';
      confirmBtnEl.textContent = '叫聽!';
      confirmBtnEl.addEventListener('click', declareTenpai);
    }

    container.appendChild(buildTable(topSeat, leftSeat, rightSeat, buildYourHandRow(handRowEl, confirmBtnEl, you)));

    const panel = document.createElement('div');
    // 結算畫面內容很長,不要用黏底(sticky)排版,不然會蓋到還沒捲到的牌桌內容
    panel.className = game.finished ? 'your-hand-panel your-hand-panel-result' : 'your-hand-panel';
    container.appendChild(panel);

    if (game.finished) {
      renderResult(panel);
      renderRevealedHands(panel);
      renderHandEndActions(panel);
      return;
    }

    if (pendingRonPrompt) {
      renderRonPrompt(panel);
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

    if (!isNormalTurn) {
      const waitingSeat = lastDiscard ? lastDiscard.seat : game.currentSeat;
      const waitingP = document.createElement('p');
      waitingP.className = 'hint';
      waitingP.textContent = `${seatLabel(waitingSeat)} 剛打出的牌正在牌桌上顯示...`;
      panel.appendChild(waitingP);
      return;
    }

    // 沒有效率分析、沒有任何提示文字 —— 只有自摸/暗槓/加槓的宣告按鈕(如果有的話)
    const canDeclareTsumo = pendingCanWin;
    const ankanOptions = findAnkanOptions(you);
    const kakanOptions = findKakanOptions(you);
    if (!canDeclareTsumo && ankanOptions.length === 0 && kakanOptions.length === 0) return;

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

  function render() {
    if (!container) return;
    container.innerHTML = '';

    if (onActiveChange) onActiveChange(phase === 'hand' || phase === 'handEnd');

    if (phase === 'setup') {
      renderSetup(container);
      return;
    }
    if (phase === 'matchEnd') {
      renderMatchSummary(container);
      return;
    }
    renderTable(container);
  }

  return {
    mount(el) {
      container = el;
      render();
      // 進畫面後才非同步跟伺服器要一次資料庫檔案內容,拿到後用伺服器版本蓋掉、重繪一次;
      // 純靜態部署(如 GitHub Pages)沒有這支 API、fetch 失敗時,fetchServerStats 回傳 null,
      // 這裡就維持原本 localStorage 讀到的內容,不受影響。
      fetchServerStats().then((serverStats) => {
        if (!serverStats) return;
        stats = serverStats;
        saveStats(stats);
        render();
      });
    },
  };
}
