import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../src/handNotation.js';
import { calculateShanten } from '../src/shanten.js';

test('已經胡牌的手牌:向聽數 -1', () => {
  const tiles = parseHand('123456789m123p456p55s'); // 17 張,5 組 + 對子
  assert.equal(calculateShanten(tiles), -1);
});

test('已經聽牌的手牌:向聽數 0', () => {
  const tiles = parseHand('123456789m12345p55s'); // 16 張,聽 3p/6p
  assert.equal(calculateShanten(tiles), 0);
});

test('差一步到聽牌:向聽數 1', () => {
  const tiles = parseHand('123456789m12345p9s1z'); // 4 組完成 + 1 個搭子 + 2 個孤張
  assert.equal(calculateShanten(tiles), 1);
});

test('完全沒有組合、非常散的手牌:向聽數是個大數字', () => {
  const tiles = parseHand('147m147p147s1234567z'); // 16 張互不相關的孤張
  const shanten = calculateShanten(tiles);
  assert.ok(shanten >= 8, `預期是很差的手牌,實際向聽數=${shanten}`);
});

test('向聽數會隨著手牌變好而下降', () => {
  const scattered = calculateShanten(parseHand('147m147p147s1234567z'));
  const oneStepBetter = calculateShanten(parseHand('1147m147p147s123456z')); // 多配成一對 1m1m
  assert.ok(oneStepBetter < scattered);
});
