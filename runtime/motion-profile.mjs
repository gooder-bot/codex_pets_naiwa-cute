/** Naiwa's choreography. Coordinates refer to the unchanged v2 atlas. */
export const PET_ID = 'custom:xiaohuangtuan';
export const MOTION_VERSION = '3.0.0';
export const HOVER_DWELL_MS = 280;
export const HOVER_COOLDOWN_MS = 4200;

const f = (rowIndex, columnIndex, frameDurationMs, transform = '') =>
  ({ rowIndex, columnIndex, frameDurationMs, transform });
const seq = (row, entries) => entries.map(([col, ms, transform]) => f(row, col, ms, transform));

export const idle = seq(0, [[0,720],[1,900],[2,820],[3,680],[4,900],[5,1080]]);
export const curiosity = [
  [f(0,5,220),f(8,1,160),f(9,3,480),f(8,1,160),f(0,0,420)],
  [f(0,5,220),f(10,7,200),f(9,2,420),f(10,7,180),f(0,0,420)]
];

export const jump = [
  f(4,0,90),f(4,1,170,'scale(1.025, .975)'),f(4,2,160),
  f(4,3,110,'scale(1.035, .970)'),f(4,4,100,'scale(.995, 1.005)'),
  f(4,4,170),f(0,0,220)
];
export const wave = seq(3, [[0,140],[1,150],[2,370],[1,140],[3,260]]);
export const happyWave = seq(3, [
  [0,140],[1,120],[2,120],[2,100,'scale(1.01, .99)'],[2,140],
  [2,100,'scale(1.008, .992)'],[2,190],[1,120],[3,300]
]);

const tasks = {
  running: {
    intro: seq(7, [[0,160],[1,220],[2,650],[3,240],[1,180],[2,450]]),
    loop: seq(7, [[2,1900],[1,240],[2,1800],[3,340],[1,220],[2,1800]]),
    still: f(7,2,0)
  },
  waiting: {
    intro: seq(6, [[0,160],[1,220],[2,450],[1,200],[3,100],[1,280]]),
    loop: seq(6, [[1,2500],[2,450],[1,3100],[4,450],[1,1900]]),
    still: f(6,1,0)
  },
  review: {
    intro: [...seq(8, [[0,140],[1,200],[2,260],[3,120]]),
      f(7,4,420,'scale(1.006, .994)'),f(8,5,560)],
    loop: seq(8, [[5,3200],[1,300],[2,450],[1,180],[5,3800]]),
    still: f(7,4,0)
  },
  failed: {
    intro: seq(5, [[0,150],[1,180],[2,320],[3,240],[4,420],[3,220],[5,350],[6,500]]),
    loop: seq(5, [[7,2500],[6,650],[5,420],[6,650],[7,3000]]),
    still: f(5,6,0)
  }
};

export function isWalking(state) { return state === 'running-left' || state === 'running-right'; }
export function statePlan(state) {
  if (tasks[state]) return tasks[state];
  if (isWalking(state)) {
    const row = state === 'running-left' ? 2 : 1;
    return { intro: [], loop: seq(row, [[0,120],[1,120],[2,120],[3,120],[4,120],[5,120],[6,120],[7,180]]), still:f(row,2,0) };
  }
  if (state === 'jumping' || state === 'waving') return {
    intro: state === 'jumping' ? jump : wave, loop: idle, still:f(0,0,0)
  };
  return { intro:[], loop:idle, still:f(0,0,0) };
}
export function settleWalk(state) {
  return [f(state === 'running-left' ? 2 : 1,6,100), f(0,0,160)];
}
export function notice(frame) {
  return frame ? [f(frame.rowIndex,frame.columnIndex,160), f(0,0,100)] : [f(0,2,160),f(0,0,100)];
}
export function lookDirection(x, y) {
  // The central dead zone avoids tiny pointer movements toggling directions.
  if (Math.hypot(x,y) < .24) return null;
  const direction = (Math.round(Math.atan2(x,-y) / (Math.PI / 8)) + 16) % 16;
  return f(9+Math.floor(direction/8),direction%8,180);
}
export function loopDuration(frames) { return frames.reduce((n, frame) => n + frame.frameDurationMs, 0); }
