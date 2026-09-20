// 台數(番數)計算。採用標準通用台數表,數值放在 scoringRules.json 方便依牌館規則調整。
//
// v1 範圍已涵蓋:門清、自摸、碰碰胡、三/四/五暗刻、混一色/清一色/字一色、
// 小/大三元、小/大四喜、花牌(正花/花槓)、全求人、聽牌型態獎勵(邊張/坎張/單吊)、
// 天胡/地胡、槓相關台數(槓/槓上開花/搶槓)。不計缺一門。
//
// 連莊/莊家加成不放在這裡:那是跨局的「場次」概念(連續當莊的次數),
// 不是單一手牌牌型能決定的東西,等做完整對局功能時再另外處理。

import { tileFromCode } from './tiles.js';
import { checkWin } from './winCheck.js';
import { getWaits } from './tingCheck.js';
import rules from './scoringRules.js';

function isDragonCode(code) {
  const t = tileFromCode(code);
  return t.suit === 'z' && t.rank >= 5 && t.rank <= 7;
}

function isWindCode(code) {
  const t = tileFromCode(code);
  return t.suit === 'z' && t.rank >= 1 && t.rank <= 4;
}

function analyzeSuits(decomposition) {
  const suitsUsed = new Set();
  let hasHonor = false;
  const noteTile = (code) => {
    const t = tileFromCode(code);
    if (t.suit === 'z') hasHonor = true;
    else suitsUsed.add(t.suit);
  };
  for (const g of decomposition.groups) g.tiles.forEach(noteTile);
  noteTile(decomposition.pair);
  return { suitsUsed, hasHonor };
}

// 判斷胡牌的那張牌在「這一種拆法」裡扮演的角色,是單吊/邊張/坎張,還是兩面(不給獎勵)
function classifyWaitShape(decomposition, winningTileCode) {
  if (decomposition.pair === winningTileCode) return 'tanki';

  for (const g of decomposition.groups) {
    if (g.type !== 'sequence') continue;
    const [low, mid, high] = g.tiles;
    if (winningTileCode !== low && winningTileCode !== mid && winningTileCode !== high) continue;

    if (winningTileCode === mid) return 'kanchan';
    const lowRank = tileFromCode(low).rank;
    const highRank = tileFromCode(high).rank;
    if (winningTileCode === high && lowRank === 1) return 'penchan';
    if (winningTileCode === low && highRank === 9) return 'penchan';
    return 'ryanmen';
  }
  return null; // 胡的那張牌是刻子的一部份(碰坎/雙碰型態),不屬於本模組計算的獎勵範圍
}

function concealedTripletCount(decomposition, winningTileCode, selfDrawn) {
  let count = 0;
  for (const g of decomposition.groups) {
    if (g.type !== 'triplet') continue;
    let concealed = g.concealed;
    if (concealed && !selfDrawn && g.tiles[0] === winningTileCode) {
      concealed = false; // 靠別人打的牌胡出來的刻子,不算暗刻
    }
    if (concealed) count++;
  }
  return count;
}

function scoreDecomposition(decomposition, hand, context, winningTileCode, waitCount) {
  const items = [];
  const add = (key, name, tai) => {
    if (tai > 0) items.push({ key, name, tai });
  };

  // 天胡/地胡直接視為總台數,不跟基本台/門清/自摸/花牌等其他項目疊加 ——
  // 符合條件就整手只算這一項,直接把結果回傳掉,不繼續往下算。
  if (context.isFirstTurn && context.selfDrawn) {
    if (context.isDealer) {
      return { items: [{ key: 'tianHu', name: '天胡', tai: rules.tianHu }], total: rules.tianHu };
    }
    return { items: [{ key: 'diHu', name: '地胡', tai: rules.diHu }], total: rules.diHu };
  }

  add('base', '基本台', rules.base);

  const melds = hand.melds ?? [];
  const isMenQing = melds.every((m) => m.type === 'ankan');
  if (isMenQing) add('menQing', '門清', rules.menQing);

  if (context.selfDrawn) add('ziMo', '自摸', rules.ziMo);

  const isQuanQiuRen = melds.length === 5 && melds.every((m) => m.type !== 'ankan') && !context.selfDrawn;
  if (isQuanQiuRen) add('quanQiuRen', '全求人', rules.quanQiuRen);

  // 聽牌型態獎勵:只有在「整手牌就只聽這一張」時才算數,若還有別的聽法(兩面/雙碰)就不給
  if (waitCount === 1) {
    const shape = classifyWaitShape(decomposition, winningTileCode);
    if (shape === 'tanki') add('danDiao', '單吊', rules.danDiao);
    else if (shape === 'penchan') add('bianZhang', '邊張', rules.bianZhang);
    else if (shape === 'kanchan') add('kanZhang', '坎張', rules.kanZhang);
  }

  const gangCount = melds.filter((m) => m.type === 'ankan' || m.type === 'minkan').length;
  if (gangCount > 0) add('gang', `槓 x${gangCount}`, rules.gang * gangCount);
  if (context.isRinshan) add('gangShangKaiHua', '槓上開花', rules.gangShangKaiHua);
  if (context.isChankan) add('qiangGang', '搶槓', rules.qiangGang);

  const allTriplets = decomposition.groups.every((g) => g.type === 'triplet');
  if (allTriplets) add('duiDuiHu', '碰碰胡', rules.duiDuiHu);

  const ankeCount = concealedTripletCount(decomposition, winningTileCode, context.selfDrawn);
  if (ankeCount >= 5) add('wuAnKe', '五暗刻', rules.wuAnKe);
  else if (ankeCount === 4) add('siAnKe', '四暗刻', rules.siAnKe);
  else if (ankeCount === 3) add('sanAnKe', '三暗刻', rules.sanAnKe);

  const { suitsUsed, hasHonor } = analyzeSuits(decomposition);
  if (suitsUsed.size === 0) add('ziYiSe', '字一色', rules.ziYiSe);
  else if (suitsUsed.size === 1 && !hasHonor) add('qingYiSe', '清一色', rules.qingYiSe);
  else if (suitsUsed.size === 1 && hasHonor) add('hunYiSe', '混一色', rules.hunYiSe);

  const dragonTriplets = decomposition.groups.filter(
    (g) => g.type === 'triplet' && isDragonCode(g.tiles[0])
  ).length;
  const pairIsDragon = isDragonCode(decomposition.pair);
  if (dragonTriplets === 3) add('daSanYuan', '大三元', rules.daSanYuan);
  else if (dragonTriplets === 2 && pairIsDragon) add('xiaoSanYuan', '小三元', rules.xiaoSanYuan);

  const windTriplets = decomposition.groups.filter(
    (g) => g.type === 'triplet' && isWindCode(g.tiles[0])
  ).length;
  const pairIsWind = isWindCode(decomposition.pair);
  if (windTriplets === 4) add('daSiXi', '大四喜', rules.daSiXi);
  else if (windTriplets === 3 && pairIsWind) add('xiaoSiXi', '小四喜', rules.xiaoSiXi);

  // 花牌:只有「正花」算台(自己座位對應的那張,梅蘭菊竹/春夏秋冬用同一個座位順序,
  // rank 1~4 對應座位 0~3、rank 5~8 也對應座位 0~3),別人座位的花不計台。
  // 另外集滿同一套(梅蘭菊竹全部,或春夏秋冬全部)算花槓,不管是不是正花都額外加台。
  const flowers = context.flowers ?? [];
  if (flowers.length > 0 && typeof context.seat === 'number') {
    const ownFlowerCount = flowers.filter((f) => (f.rank - 1) % 4 === context.seat).length;
    if (ownFlowerCount > 0) add('huaPai', `正花 x${ownFlowerCount}`, rules.huaPai * ownFlowerCount);

    const hasFullSet = (startRank) =>
      [0, 1, 2, 3].every((offset) => flowers.some((f) => f.rank === startRank + offset));
    const huaGangSets = (hasFullSet(1) ? 1 : 0) + (hasFullSet(5) ? 1 : 0);
    if (huaGangSets > 0) add('huaGang', `花槓 x${huaGangSets}`, rules.huaGang * huaGangSets);
  }

  const total = items.reduce((sum, it) => sum + it.tai, 0);
  return { items, total };
}

/**
 * hand = { concealedTiles: Tile[] (胡牌前16張,含melds外的手牌), melds?: [...] }
 * winningTile = Tile
 * context = { selfDrawn: boolean, seat?: number (0~3,用來判斷正花), flowers?: Tile[] }
 *
 * 一手牌可能有不只一種拆法(例如可拆成不同的順子/刻子組合),
 * 依照慣例採計「台數最高」的那一種拆法。
 */
export function computeScore(hand, winningTile, context = {}) {
  const winningTileCode = `${winningTile.rank}${winningTile.suit}`;
  const fullHand = {
    concealedTiles: [...hand.concealedTiles, winningTile],
    melds: hand.melds,
  };

  const result = checkWin(fullHand);
  if (!result.win) return null;

  const waitCount = getWaits({ concealedTiles: hand.concealedTiles, melds: hand.melds }).length;

  let best = null;
  for (const decomposition of result.decompositions) {
    const scored = scoreDecomposition(decomposition, hand, context, winningTileCode, waitCount);
    if (!best || scored.total > best.total) {
      best = { ...scored, decomposition };
    }
  }
  return best;
}
