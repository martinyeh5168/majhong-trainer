import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand, formatHand, handToDisplay } from '../src/handNotation.js';

test('parseHand 解析標準記牌法', () => {
  const tiles = parseHand('123m456p55z');
  assert.equal(tiles.length, 8);
  assert.deepEqual(tiles[0], { suit: 'm', rank: 1 });
  assert.deepEqual(tiles[3], { suit: 'p', rank: 4 });
  assert.deepEqual(tiles[6], { suit: 'z', rank: 5 });
});

test('parseHand 允許空白分隔', () => {
  const tiles = parseHand('123m 456p 55z');
  assert.equal(tiles.length, 8);
});

test('parseHand 對不合法輸入丟出錯誤', () => {
  assert.throws(() => parseHand('9z')); // 字牌只有 1-7
  assert.throws(() => parseHand('12x'));
  assert.throws(() => parseHand('12')); // 缺花色字母
});

test('formatHand 排序並輸出標準記牌法', () => {
  const tiles = parseHand('321m');
  assert.equal(formatHand(tiles), '123m');
});

test('parseHand -> formatHand 往返一致', () => {
  const notation = '123456789m123p55z';
  assert.equal(formatHand(parseHand(notation)), notation);
});

test('handToDisplay 顯示中文', () => {
  assert.equal(handToDisplay(parseHand('123m')), '一萬 二萬 三萬');
});
