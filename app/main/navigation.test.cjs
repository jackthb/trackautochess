const { test } = require('node:test');
const assert = require('node:assert/strict');
const { externalWebUrl, protectRendererNavigation } = require('./navigation.cjs');

test('external links reject OS handlers, credentials and malformed values', () => {
  for (const value of ['file:///C:/secret', 'javascript:alert(1)', 'steam://run/570', 'https://user:password@example.com', '/relative', {}, null]) {
    assert.equal(externalWebUrl(value), null);
  }
  assert.equal(externalWebUrl('https://www.trackautochess.com/players/1'), 'https://www.trackautochess.com/players/1');
});

test('popups are denied and renderer navigation cannot replace the trusted app', () => {
  let popup, navigate;
  const opened = [];
  protectRendererNavigation({ setWindowOpenHandler(fn) { popup = fn; }, on(name, fn) { assert.equal(name, 'will-navigate'); navigate = fn; } }, url => { opened.push(url); return Promise.resolve(); });
  assert.deepEqual(popup({url:'file:///secret'}), {action:'deny'});
  assert.deepEqual(popup({url:'https://example.com/'}), {action:'deny'});
  let prevented = false;
  navigate({preventDefault() { prevented = true; }}, 'javascript:alert(1)');
  assert.equal(prevented, true);
  assert.deepEqual(opened, ['https://example.com/']);
});
