import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../src/handNotation.js';
import { analyzeDiscards, analyzeDiscardsGeneral } from '../src/efficiency.js';
import { calculateShanten } from '../src/shanten.js';

test('17張手牌:打掉沒用的浮牌,聽牌進張數最多,排在第一名', () => {
  // 123456789m123p45p55s 已經是聽 3p/6p 的牌,多摸一張沒用的 9s
  const concealedTiles = parseHand('123456789m123p45p55s9s');
  assert.equal(concealedTiles.length, 17);

  const results = analyzeDiscards(concealedTiles, [], concealedTiles);
  const best = results[0];

  assert.equal(best.discard, '9s');
  assert.equal(best.isTenpai, true);
  const waitCodes = best.waits.map((w) => w.code).sort();
  assert.deepEqual(waitCodes, ['3p', '6p']);
  assert.equal(best.ukeire, 7); // 手牌裡已經有一張 3p,所以 3p 剩 3 張、6p 剩 4 張
  assert.equal(results.every((r) => r.ukeire <= best.ukeire), true);
});

test('通用版分析:已經接近聽牌的手牌,結果跟舊版一致', () => {
  const concealedTiles = parseHand('123456789m123p45p55s1z');
  const results = analyzeDiscardsGeneral(concealedTiles, [], concealedTiles);
  const best = results[0];

  assert.equal(best.discard, '1z');
  assert.equal(best.shanten, 0);
  const usefulCodes = best.usefulTiles.map((u) => u.code).sort();
  assert.deepEqual(usefulCodes, ['3p', '6p']);
  assert.equal(results.every((r) => r.shanten >= best.shanten), true);
});

test('通用版分析:離聽牌還很遠的手牌,也能挑出向聽數最小的打法', () => {
  // 這手牌完全沒有組合,打哪張都差不多,但至少要能正常算出一個結果,不能噴錯
  const concealedTiles = parseHand('147m147p147s1234567z2z');
  assert.equal(concealedTiles.length, 17);
  const results = analyzeDiscardsGeneral(concealedTiles, [], concealedTiles);

  assert.equal(results.length, 16); // 17 張牌裡 2z 重複了一次,所以只有 16 種不重複的牌
  const best = results[0];
  // 拿掉任一張牌之後,直接用 calculateShanten 驗證分析結果跟引擎本身算的一致
  for (const r of results) {
    const idx = concealedTiles.findIndex((t) => `${t.rank}${t.suit}` === r.discard);
    const remaining = [...concealedTiles.slice(0, idx), ...concealedTiles.slice(idx + 1)];
    assert.equal(calculateShanten(remaining), r.shanten);
  }
  assert.equal(results.every((r) => r.shanten >= best.shanten), true);
});

test('通用版分析:某張進張已經被摸完(4張都看過了),就不列進希望進張裡', () => {
  const concealedTiles = parseHand('123456789m123p45p55s1z');
  // 手牌裡已經有一張 3p,場上再看到 3 張 3p(自己棄牌或別人打出),3p 就摸不到了
  const visibleTiles = [...concealedTiles, ...parseHand('333p')];
  const results = analyzeDiscardsGeneral(concealedTiles, [], visibleTiles);
  const best = results.find((r) => r.discard === '1z');

  const usefulCodes = best.usefulTiles.map((u) => u.code);
  assert.deepEqual(usefulCodes, ['6p']); // 3p 已經沒了,不該出現在名單裡
  assert.equal(best.ukeire, 4); // 只剩 6p 的張數
});
