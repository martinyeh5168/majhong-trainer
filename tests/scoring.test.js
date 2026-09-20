import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../src/handNotation.js';
import { computeScore } from '../src/scoring.js';

function tai(items, key) {
  return items.find((it) => it.key === key)?.tai ?? 0;
}

test('三色混合順子胡牌,自摸門清:基本台+門清+自摸', () => {
  const concealedTiles = parseHand('123456789m123p45p55s'); // 缺 6p
  const winningTile = { suit: 'p', rank: 6 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(score.total, 3);
  assert.equal(tai(score.items, 'base'), 1);
  assert.equal(tai(score.items, 'menQing'), 1);
  assert.equal(tai(score.items, 'ziMo'), 1);
  assert.equal(tai(score.items, 'duiDuiHu'), 0);
});

test('五組刻子自摸:碰碰胡 + 五暗刻同時成立', () => {
  const concealedTiles = parseHand('111m222m333m444p55p66s'); // 缺 5p
  const winningTile = { suit: 'p', rank: 5 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'duiDuiHu'), 4);
  assert.equal(tai(score.items, 'wuAnKe'), 8);
  assert.equal(score.total, 1 + 1 + 1 + 4 + 8); // base+門清+自摸+碰碰胡+五暗刻
});

test('點炮胡出的那副刻子不算暗刻:五暗刻降為四暗刻', () => {
  const concealedTiles = parseHand('111m222m333m444p55p66s'); // 缺 5p,靠別人打出
  const winningTile = { suit: 'p', rank: 5 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: false });
  assert.equal(tai(score.items, 'siAnKe'), 5);
  assert.equal(tai(score.items, 'wuAnKe'), 0);
  assert.equal(tai(score.items, 'ziMo'), 0);
  assert.equal(tai(score.items, 'menQing'), 1); // 點炮胡不影響門清
});

test('清一色(單一花色,無字牌)', () => {
  // 123m 234m 345m 456m 567m + 對子99m,缺一張 7m
  const concealedTiles = parseHand('1223334445556699m');
  const winningTile = { suit: 'm', rank: 7 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'qingYiSe'), 8);
  assert.equal(tai(score.items, 'hunYiSe'), 0);
});

test('字一色 + 大四喜同時成立(東南西北四組刻子 + 中發對子)', () => {
  // 東東東 南南南 西西西 北北北 中中中 + 對子發,缺一張發
  const concealedTiles = parseHand('1112223334445556z');
  const winningTile = { suit: 'z', rank: 6 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'ziYiSe'), 16);
  assert.equal(tai(score.items, 'daSiXi'), 16);
});

test('用兩種花色(不含字牌)胡牌,不計缺一門,也不算清一色/混一色', () => {
  // 123m 456m + 123p 456p 789p + 對子99m,缺一張 9p
  const concealedTiles = parseHand('12345699m12345678p');
  const winningTile = { suit: 'p', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'queYiMen'), 0);
  assert.equal(tai(score.items, 'qingYiSe'), 0);
  assert.equal(tai(score.items, 'hunYiSe'), 0);
});

test('正花才算台,別人座位的花不計台', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  // rank 1(梅)、5(春)是座位 0 的正花;rank 2(蘭)是座位 1 的花,對座位 0 來說不是正花
  const flowers = [{ suit: 'f', rank: 1 }, { suit: 'f', rank: 5 }, { suit: 'f', rank: 2 }];
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true, seat: 0, flowers });
  assert.equal(tai(score.items, 'huaPai'), 2);
});

test('沒有正花(全部都是別人座位的花)不加花牌台', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  const flowers = [{ suit: 'f', rank: 2 }, { suit: 'f', rank: 3 }];
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true, seat: 0, flowers });
  assert.equal(tai(score.items, 'huaPai'), 0);
});

test('花杠:集滿梅蘭菊竹或春夏秋冬其中一套,額外加台', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  // 梅蘭菊竹(rank 1~4)集滿一套花杠,其中只有 rank 1 是座位 0 的正花
  const flowers = [1, 2, 3, 4].map((rank) => ({ suit: 'f', rank }));
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true, seat: 0, flowers });
  assert.equal(tai(score.items, 'huaPai'), 1);
  assert.equal(tai(score.items, 'huaGang'), 2);
});

test('三暗刻:剛好 3 組暗刻,另外兩組是順子', () => {
  const concealedTiles = parseHand('111m222m333m456p78s66p'); // 缺 9s,自摸
  const winningTile = { suit: 's', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'sanAnKe'), 2);
  assert.equal(tai(score.items, 'siAnKe'), 0);
  assert.equal(tai(score.items, 'duiDuiHu'), 0); // 有兩組順子,不是碰碰胡
});

test('小三元:兩組龍刻 + 龍將,另外兩組是順子', () => {
  // 中中中、發發發是刻子,白白是將眼,123m/456p 是順子,缺 9s(把 78s 補成 789s)
  const concealedTiles = parseHand('555z666z77z123m78s456p');
  const winningTile = { suit: 's', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'xiaoSanYuan'), 4);
  assert.equal(tai(score.items, 'daSanYuan'), 0);
});

test('大三元:中發白三組都是刻子(將眼隨意)', () => {
  const concealedTiles = parseHand('555z666z777z11m78s456p'); // 缺 9s,自摸
  const winningTile = { suit: 's', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'daSanYuan'), 8);
  assert.equal(tai(score.items, 'xiaoSanYuan'), 0); // 大小三元互斥,不會同時給
});

test('小四喜:三組風刻 + 風將,另外一組是順子', () => {
  // 東南西是刻子,北北是將眼,123m 是順子,缺 9s(把 78s 補成 789s)
  const concealedTiles = parseHand('111z222z333z44z78s123m');
  const winningTile = { suit: 's', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'xiaoSiXi'), 8);
  assert.equal(tai(score.items, 'daSiXi'), 0);
});

test('搶槓:context.isChankan 標記時額外加台', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: false, isChankan: true });
  assert.equal(tai(score.items, 'qiangGang'), 1);
});

test('全求人:五組都靠吃碰而來,胡的是最後那對將眼', () => {
  const concealedTiles = parseHand('9s'); // 只剩一張孤張,靠別人打的牌配成對
  const melds = [
    { type: 'pon', tiles: parseHand('111m') },
    { type: 'pon', tiles: parseHand('222m') },
    { type: 'pon', tiles: parseHand('333m') },
    { type: 'pon', tiles: parseHand('444p') },
    { type: 'chi', tiles: parseHand('123p') },
  ];
  const winningTile = { suit: 's', rank: 9 };
  const score = computeScore({ concealedTiles, melds }, winningTile, { selfDrawn: false });
  assert.equal(tai(score.items, 'quanQiuRen'), 2);
  assert.equal(tai(score.items, 'menQing'), 0); // 有吃碰,不是門清
  assert.equal(tai(score.items, 'danDiao'), 1); // 同時也是單吊型態
});

test('邊張:留 12 只能等 3', () => {
  const concealedTiles = parseHand('456m789m123p456p99s12s');
  const winningTile = { suit: 's', rank: 3 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: false });
  assert.equal(tai(score.items, 'bianZhang'), 1);
  assert.equal(tai(score.items, 'kanZhang'), 0);
  assert.equal(tai(score.items, 'danDiao'), 0);
});

test('坎張:留 13 只能等 2', () => {
  const concealedTiles = parseHand('456m789m123p456p99s13s');
  const winningTile = { suit: 's', rank: 2 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'kanZhang'), 1);
  assert.equal(tai(score.items, 'bianZhang'), 0);
});

test('單吊:四組已完成,只剩一張孤張等配對', () => {
  const concealedTiles = parseHand('123m456m789m123p456p9s');
  const winningTile = { suit: 's', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'danDiao'), 1);
});

test('兩面聽(兩張都能胡)不給聽牌型態獎勵', () => {
  const concealedTiles = parseHand('123m456m789m123p99s45p'); // 45p 等 3p 或 6p
  const winningTile = { suit: 'p', rank: 6 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'danDiao'), 0);
  assert.equal(tai(score.items, 'bianZhang'), 0);
  assert.equal(tai(score.items, 'kanZhang'), 0);
});

test('天胡:直接視為總台數,不跟基本台/門清/自摸疊加', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  const score = computeScore(
    { concealedTiles },
    winningTile,
    { selfDrawn: true, isDealer: true, isFirstTurn: true }
  );
  assert.equal(tai(score.items, 'tianHu'), 16);
  assert.equal(tai(score.items, 'diHu'), 0);
  assert.equal(tai(score.items, 'base'), 0); // 不疊加基本台
  assert.equal(tai(score.items, 'menQing'), 0); // 不疊加門清
  assert.equal(tai(score.items, 'ziMo'), 0); // 不疊加自摸
  assert.equal(score.total, 16); // 總台數就是 16,不是 16+其他項目
});

test('地胡:直接視為總台數,不跟基本台/門清/自摸疊加', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  const score = computeScore(
    { concealedTiles },
    winningTile,
    { selfDrawn: true, isDealer: false, isFirstTurn: true }
  );
  assert.equal(tai(score.items, 'diHu'), 8);
  assert.equal(tai(score.items, 'tianHu'), 0);
  assert.equal(tai(score.items, 'base'), 0);
  assert.equal(score.total, 8);
});

test('槓:手牌裡有暗槓時,依槓的數量加台,且不影響門清', () => {
  const concealedTiles = parseHand('123456789m5567p'); // 缺 5p 或 8p 補齊 567p+55p 之類
  const melds = [{ type: 'ankan', tiles: parseHand('1111z') }];
  const winningTile = { suit: 'p', rank: 8 };
  const score = computeScore({ concealedTiles, melds }, winningTile, { selfDrawn: true });
  assert.equal(tai(score.items, 'gang'), 1);
  assert.equal(tai(score.items, 'menQing'), 1); // 暗槓不影響門清
});

test('槓上開花與搶槓由外部情境旗標控制', () => {
  const concealedTiles = parseHand('123456789m123p45p55s');
  const winningTile = { suit: 'p', rank: 6 };
  const score = computeScore(
    { concealedTiles },
    winningTile,
    { selfDrawn: true, isRinshan: true }
  );
  assert.equal(tai(score.items, 'gangShangKaiHua'), 1);

  const scoreChankan = computeScore(
    { concealedTiles },
    winningTile,
    { selfDrawn: false, isChankan: true }
  );
  assert.equal(tai(scoreChankan.items, 'qiangGang'), 1);
});

test('沒胡牌時回傳 null', () => {
  const concealedTiles = parseHand('147m147p147s1234567z').slice(0, 16);
  const winningTile = { suit: 'm', rank: 9 };
  const score = computeScore({ concealedTiles }, winningTile, { selfDrawn: true });
  assert.equal(score, null);
});
