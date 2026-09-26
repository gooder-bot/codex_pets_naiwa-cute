import test from 'node:test';
import assert from 'node:assert/strict';
import { installNaiwa } from './naiwa-motion.mjs';

class Target {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
  }
}

function fixture(input = {}) {
  const win = new Target(), doc = new Target(), host = new Target();
  let time = 0, serial = 0;
  const timers = new Map();
  win.setTimeout = (callback, delay) => {
    timers.set(++serial, { callback, at: time + delay });
    return serial;
  };
  win.clearTimeout = id => timers.delete(id);
  doc.hidden = false;
  doc.defaultView = win;
  const element = {
    ownerDocument: doc, dataset: {},
    style: { transform:'rotate(1deg)', transformOrigin:'center', transition:'none', animation:'original' },
    closest: () => host,
    getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 })
  };
  const originalStyle = { ...element.style };
  const controller = installNaiwa(element, input, { window:win, now:() => time });
  const earliest = () => [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  function next() {
    const item = earliest();
    assert.ok(item, 'expected a pending animation timer');
    const [id, timer] = item;
    timers.delete(id); time = timer.at; timer.callback();
  }
  function advance(ms) {
    const target = time + ms;
    while (earliest()?.[1].at <= target) next();
    time = target;
  }
  function finishPhase(phase) {
    const seen = [];
    for (let i = 0; controller.snapshot().phase === phase; i++) {
      assert.ok(i < 100, `${phase} did not finish`);
      seen.push(element.dataset.naiwaFrame);
      next();
    }
    return seen;
  }
  const enter = () => host.emit('pointerenter', { clientX:90, clientY:15 });
  return { win, doc, host, element, controller, timers, originalStyle, advance, next, finishPhase, enter };
}

test('a pointer passing through briefly does not interrupt the pet with a greeting', t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  f.enter();
  f.advance(120);
  f.host.emit('pointerleave');
  f.advance(2000);
  assert.equal(f.controller.snapshot().greetings, 0);
  assert.equal(f.controller.snapshot().phase, 'quiet');
});

test('a held hover greets once, lands completely, and resumes the newest task', t => {
  const f = fixture({ state:'running' });
  t.after(() => f.controller.dispose());
  f.enter();
  f.advance(279);
  assert.equal(f.controller.snapshot().greetings, 0);
  f.advance(1);
  assert.equal(f.controller.snapshot().phase, 'interaction');
  f.advance(360);
  assert.equal(f.controller.snapshot().frame.rowIndex, 4, 'the greeting reached its jump');
  f.host.emit('pointerleave');
  f.controller.update({ state:'waiting' });
  f.controller.update({ state:'review' });
  assert.equal(f.controller.snapshot().phase, 'interaction');
  const remaining = f.finishPhase('interaction');
  assert.ok(remaining.indexOf('4:3') >= 0, 'landing contact was displayed');
  assert.ok(remaining.indexOf('4:4') > remaining.indexOf('4:3'), 'recovery followed contact');
  assert.equal(remaining.at(-1), '0:0', 'the pet stood still before changing task');
  assert.equal(f.controller.snapshot().state, 'review');
  assert.equal(f.controller.snapshot().phase, 'intro');
  assert.equal(f.controller.snapshot().frame.rowIndex, 8);
  f.enter();
  f.advance(300);
  assert.equal(f.controller.snapshot().greetings, 1, 'cooldown prevented a second greeting');
});

test('task introductions settle into quieter loops and ordinary updates do not restart them', t => {
  for (const state of ['running', 'waiting', 'review', 'failed']) {
    const f = fixture({ state });
    t.after(() => f.controller.dispose());
    assert.equal(f.controller.snapshot().phase, 'intro', state);
    f.finishPhase('intro');
    assert.equal(f.controller.snapshot().phase, 'quiet', state);
    assert.ok(f.controller.snapshot().frame.frameDurationMs >= 1500, `${state} holds a readable pose`);
    f.next();
    const current = f.controller.snapshot();
    f.controller.update({ state });
    assert.equal(f.controller.snapshot().phase, 'quiet', state);
    assert.equal(f.controller.snapshot().index, current.index, `${state} was not restarted`);
  }
});

test('dragging cancels a pending greeting and stopping settles before the latest task', t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  f.enter();
  f.advance(100);
  f.host.emit('pointerdown');
  f.controller.update({ state:'running-right' });
  f.advance(500);
  assert.equal(f.controller.snapshot().greetings, 0);
  assert.equal(f.controller.snapshot().phase, 'walk');
  f.win.emit('pointerup');
  f.controller.update({ state:'running' });
  assert.equal(f.controller.snapshot().phase, 'settle');
  f.controller.update({ state:'waiting' });
  const settling = f.finishPhase('settle');
  assert.equal(settling.at(-1), '0:0');
  assert.equal(f.controller.snapshot().state, 'waiting');
  assert.equal(f.controller.snapshot().phase, 'intro');
  assert.equal(f.controller.snapshot().frame.rowIndex, 6);
});

test('reduced motion remains still without animation or hover timers', t => {
  const f = fixture({ state:'running', reducedMotion:true });
  t.after(() => f.controller.dispose());
  f.enter();
  assert.equal(f.controller.snapshot().phase, 'still');
  assert.equal(f.timers.size, 0);
  assert.equal(f.element.style.transform, '');
  f.controller.update({ state:'review' });
  assert.equal(f.controller.snapshot().phase, 'still');
  assert.equal(f.timers.size, 0);
  f.controller.update({ reducedMotion:false });
  assert.equal(f.timers.size, 1, 'animation resumes when requested');
  f.enter();
  assert.equal(f.timers.size, 2, 'a greeting is now pending as well');
  f.controller.update({ reducedMotion:true });
  assert.equal(f.timers.size, 0, 'enabling reduced motion cancels animation and greeting');
});

test('disposing removes listeners and pending work and restores prior styling', () => {
  const f = fixture();
  f.enter();
  assert.equal(f.timers.size, 2, 'animation and dwell are both pending');
  assert.ok(f.host.listenerCount + f.win.listenerCount + f.doc.listenerCount > 0);
  f.controller.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.host.listenerCount + f.win.listenerCount + f.doc.listenerCount, 0);
  for (const [property, value] of Object.entries(f.originalStyle)) {
    assert.equal(f.element.style[property], value);
  }
  assert.deepEqual(f.element.dataset, {});
  f.enter();
  f.advance(10000);
  assert.equal(f.timers.size, 0);
  assert.equal(f.controller.snapshot().greetings, 0);
});
