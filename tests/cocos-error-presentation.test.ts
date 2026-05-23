import test from 'node:test';
import assert from 'node:assert/strict';
import { CocosErrorPresenter } from '../src/cocos-creator-adapter';

test('CocosErrorPresenter extracts stable error codes without platform dependencies', () => {
  const presenter = new CocosErrorPresenter();
  assert.deepEqual(presenter.present(new Error('ERR_SAVE_SLOT_NOT_FOUND:slot_a')), {
    code: 'ERR_SAVE_SLOT_NOT_FOUND',
    message: 'ERR_SAVE_SLOT_NOT_FOUND:slot_a'
  });
  assert.deepEqual(presenter.present('plain failure'), {
    code: null,
    message: 'plain failure'
  });
});
