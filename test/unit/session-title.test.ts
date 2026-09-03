import test from 'node:test'
import assert from 'node:assert/strict'
import { titleFromUserText } from '../../src/acp/session-title.js'

test('titleFromUserText: uses first non-empty line and collapses whitespace', () => {
  assert.equal(titleFromUserText('  Fix  the   login  '), 'Fix the login')
  assert.equal(titleFromUserText('\n\nH92 LightGBM 差因调查\nmore context'), 'H92 LightGBM 差因调查')
})

test('titleFromUserText: ignores slash commands and empty text', () => {
  assert.equal(titleFromUserText('/name something'), null)
  assert.equal(titleFromUserText('   \n  '), null)
  assert.equal(titleFromUserText(null), null)
})

test('titleFromUserText: truncates long titles', () => {
  const long = 'x'.repeat(120)
  const title = titleFromUserText(long)
  assert.equal(title?.length, 80)
})
