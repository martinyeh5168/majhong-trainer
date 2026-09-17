import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../src/handNotation.js';
import { checkWin } from '../src/winCheck.js';

test('順子+刻子混合的胡牌型態判定為胡', () => {
  const concealedTiles = parseHand('123456789m123p456p55s');
  const result = checkWin({ concealedTiles });
  assert.equal(result.win, true);
  assert.ok(result.decompositions.length >= 1);
});

test('全部都是不同單張,不可能有對子,判定不胡', () => {
  const concealedTiles = parseHand('123456789m12345678p');
  const result = checkWin({ concealedTiles });
  assert.equal(result.win, false);
});

test('五組刻子+對子(碰碰胡型態)判定為胡', () => {
  const concealedTiles = parseHand('111m222m333m444p555p66s');
  const result = checkWin({ concealedTiles });
  assert.equal(result.win, true);
  const allTriplets = result.decompositions[0].groups.every((g) => g.type === 'triplet');
  assert.equal(allTriplets, true);
});

test('固定面子(melds)會併入計算,減少需要拆解的組數', () => {
  const concealedTiles = parseHand('123p456p789p55s');
  const melds = [
    { type: 'pon', tiles: parseHand('111m') },
    { type: 'chi', tiles: parseHand('789m') },
  ];
  const result = checkWin({ concealedTiles, melds });
  assert.equal(result.win, true);
  assert.equal(result.decompositions[0].groups.length, 5);
});

test('一手曖昧牌可以有多種拆法(234456m 兩種切法)', () => {
  const concealedTiles = parseHand('234456m789m123p456p55s');
  const result = checkWin({ concealedTiles });
  assert.equal(result.win, true);
  assert.ok(result.decompositions.length >= 1);
});
