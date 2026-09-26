import { MOTION_VERSION, HOVER_DWELL_MS, HOVER_COOLDOWN_MS, idle, curiosity,
  jump, wave, happyWave, statePlan, isWalking, settleWalk, notice, lookDirection } from './motion-profile.mjs';

const controllers = new WeakMap();

/** One controller per sprite: React updates supply the latest task, without cutting a landing short. */
export function installNaiwa(element, initial = {}, environment = {}) {
  controllers.get(element)?.dispose();
  const win = environment.window ?? element.ownerDocument.defaultView;
  const doc = element.ownerDocument;
  const now = environment.now ?? (() => win.performance.now());
  const host = element.closest('[data-avatar-mascot]') ?? element;
  const saved = { transform:element.style.transform, transformOrigin:element.style.transformOrigin,
    transition:element.style.transition, animation:element.style.animation };
  let input = { state:'idle', rows:11, reducedMotion:false, lookFrame:null, ...initial };
  let timer = null, dwell = null, disposed = false, inside = false, pressed = false;
  let frames = [], index = 0, onEnd = null, phase = 'state', state = input.state;
  let nextHover = -Infinity, greetings = 0, idleLoops = 0, glance = 0, pointerLook = null;
  let displayed = null;
  element.dataset.naiwaMotion = MOTION_VERSION;
  element.style.transformOrigin = '50% 97%';
  element.style.animation = 'none';

  function clearTimer() { if (timer !== null) win.clearTimeout(timer); timer = null; }
  function clearDwell() { if (dwell !== null) win.clearTimeout(dwell); dwell = null; }
  function render(frame) {
    displayed = frame;
    const rows = input.rows ?? 11;
    element.style.backgroundPosition = `${frame.columnIndex/7*100}% ${frame.rowIndex/(rows-1)*100}%`;
    element.style.transition = input.reducedMotion ? 'none' : `transform ${Math.min(frame.frameDurationMs,110)}ms ease-out`;
    element.style.transform = input.reducedMotion ? '' : frame.transform || '';
    element.dataset.naiwaPhase = phase;
    element.dataset.naiwaFrame = `${frame.rowIndex}:${frame.columnIndex}`;
  }
  function schedule() {
    if (disposed || doc.hidden || input.reducedMotion || !frames.length) return;
    timer = win.setTimeout(() => {
      timer = null;
      index++;
      if (index === frames.length) { onEnd?.(); return; }
      render(frames[index]); schedule();
    }, frames[index].frameDurationMs);
  }
  function play(sequence, kind, end) {
    clearTimer(); frames = sequence; index = 0; phase = kind; onEnd = end;
    render(frames[0]); schedule();
  }
  function quiet() {
    if (input.state !== state) { enterState(input.state); return; }
    const plan = statePlan(state);
    if (state === 'idle' && ++idleLoops % 5 === 0 && !inside && !input.lookFrame) {
      play(curiosity[glance++ % curiosity.length], 'curiosity', quiet);
    } else {
      play(plan.loop, isWalking(state) ? 'walk' : 'quiet', quiet);
    }
  }
  function enterState(next) {
    state = next; idleLoops = 0;
    const plan = statePlan(state);
    if (input.reducedMotion) { clearTimer(); phase='still'; render(plan.still); return; }
    if (input.lookFrame && !isWalking(state)) {
      clearTimer(); phase='look'; render(input.lookFrame); return;
    }
    if (plan.intro.length) play(plan.intro, 'intro', quiet);
    else quiet();
  }
  function finishInteraction() {
    if (input.state === state && !input.lookFrame) quiet();
    else enterState(input.state);
  }
  function greet() {
    dwell = null;
    if (!inside || pressed || disposed || input.reducedMotion || isWalking(input.state)) return;
    nextHover = now() + HOVER_COOLDOWN_MS;
    const choice = greetings++ % 3;
    const action = choice === 0 ? jump : choice === 1 ? wave : happyWave;
    play([...notice(pointerLook), ...action], 'interaction', finishInteraction);
  }
  function pointerMove(event) {
    const rect = element.getBoundingClientRect();
    pointerLook = lookDirection((event.clientX-rect.left-rect.width/2)/(rect.width/2),
      (event.clientY-rect.top-rect.height*.34)/(rect.height/2));
  }
  function pointerEnter(event) {
    inside = true; pointerMove(event);
    if (!pressed && !input.reducedMotion && now() >= nextHover && phase !== 'interaction') {
      clearDwell(); dwell = win.setTimeout(greet,HOVER_DWELL_MS);
    }
  }
  function pointerLeave() { inside=false; clearDwell(); }
  function pointerDown() { pressed=true; clearDwell(); }
  function pointerUp() { pressed=false; }
  function visibilityChange() {
    clearTimer(); clearDwell();
    if (!doc.hidden && !disposed) enterState(input.state);
  }

  const bindings = [[host,'pointerenter',pointerEnter],[host,'pointerleave',pointerLeave],
    [host,'pointermove',pointerMove],[host,'pointerdown',pointerDown],
    [win,'pointerup',pointerUp],[win,'pointercancel',pointerUp],[doc,'visibilitychange',visibilityChange]];
  for (const [target,type,handler] of bindings) target.addEventListener(type,handler);

  const controller = {
    update(next) {
      const previous = input;
      input = {...input,...next};
      if (input.reducedMotion) { clearDwell(); enterState(input.state); return; }
      if (previous.reducedMotion) { enterState(input.state); return; }
      if (phase === 'interaction' && !isWalking(input.state)) return;
      if (phase === 'settle' && !isWalking(input.state)) return;
      if (input.state !== state) {
        if (isWalking(state) && !isWalking(input.state)) {
          play(settleWalk(state),'settle',finishInteraction);
        } else enterState(input.state);
      } else if (input.lookFrame !== previous.lookFrame) {
        if (input.lookFrame && !isWalking(state)) { clearTimer(); phase='look'; render(input.lookFrame); }
        else enterState(input.state);
      }
    },
    dispose() {
      if (disposed) return;
      disposed=true; clearTimer(); clearDwell();
      for (const [target,type,handler] of bindings) target.removeEventListener(type,handler);
      Object.assign(element.style,saved);
      delete element.dataset.naiwaMotion; delete element.dataset.naiwaPhase; delete element.dataset.naiwaFrame;
      if (controllers.get(element) === controller) controllers.delete(element);
    },
    snapshot() { return {state:input.state,phase,index,frame:displayed,greetings}; }
  };
  controllers.set(element,controller);
  enterState(input.state);
  return controller;
}

export function updateNaiwa(element, input) { controllers.get(element)?.update(input); }
