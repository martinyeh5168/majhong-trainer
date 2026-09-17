import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTile, tileCode, tileFromCode, tileDisplayName, isHonor, isTerminal } from '../src/tiles.js';

test('tileCode 與 tileFromCode 互為反函式', () => {
  const tile = makeTile('p', 7);
  assert.equal(tileCode(tile), '7p');
  assert.deepEqual(tileFromCode('7p'), tile);
});

test('tileDisplayName 顯示中文', () => {
  assert.equal(tileDisplayName(makeTile('m', 1)), '一萬');
  assert.equal(tileDisplayName(makeTile('s', 9)), '九條');
  assert.equal(tileDisplayName(makeTile('z', 1)), '東');
  assert.equal(tileDisplayName(makeTile('z', 5)), '中');
  assert.equal(tileDisplayName(makeTile('z', 7)), '白');
});

test('isHonor / isTerminal', () => {
  assert.equal(isHonor(makeTile('z', 3)), true);
  assert.equal(isHonor(makeTile('m', 3)), false);
  assert.equal(isTerminal(makeTile('m', 1)), true);
  assert.equal(isTerminal(makeTile('m', 5)), false);
  assert.equal(isTerminal(makeTile('z', 1)), false);
});
