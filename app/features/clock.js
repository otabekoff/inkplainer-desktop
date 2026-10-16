// The page's clock.
//
// Inkplainer advances its animation one step per requestAnimationFrame, which in a browser
// ties the speed to the monitor (4x faster on a 240 Hz screen). Here:
//  - Live: animation frames run at a fixed 60 per second whatever the refresh rate.
//  - Manual (while rendering the movie for export or the preview player): the clock is
//    stepped by hand, 1/60 s at a time. Animation frames, setTimeout and performance.now /
//    Date.now all follow it, so a render produces every step in order, never drops one, and
//    plays exactly like the live preview.
//
// Exposed as window.inkClock for features/movie.js.
(() => {
  const STEPS_PER_SECOND = 60;
  const TICK = 1000 / STEPS_PER_SECOND;

  const native = {
    raf: window.requestAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    perfNow: performance.now.bind(performance),
    dateNow: Date.now,
  };

  let frameQueue = new Map();
  let nextFrameId = 1;
  window.requestAnimationFrame = (cb) => {
    const id = nextFrameId++;
    frameQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frameQueue.delete(id);
  };

  function runFrame(time) {
    const batch = frameQueue;
    frameQueue = new Map();
    for (const cb of batch.values()) {
      try {
        cb(time);
      } catch (err) {
        reportError(err);
      }
    }
  }

  let manual = false;
  let virtualNow = 0;
  let virtualStart = 0;
  let dateAtStart = 0;
  let timers = []; // { id, at, fn, args } while manual
  let nextTimerId = -1; // negative so they never collide with the browser's ids

  performance.now = () => (manual ? virtualNow : native.perfNow());
  Date.now = () => (manual ? dateAtStart + (virtualNow - virtualStart) : native.dateNow());
  window.setTimeout = (fn, ms = 0, ...args) => {
    if (!manual || typeof fn !== "function") return native.setTimeout(fn, ms, ...args);
    const id = nextTimerId--;
    timers.push({ id, at: virtualNow + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.clearTimeout = (id) => {
    if (typeof id === "number" && id < 0) timers = timers.filter((t) => t.id !== id);
    else native.clearTimeout(id);
  };

  // Live: at most one animation frame per 1/60 s, at most one per display refresh.
  let lastTick = native.perfNow();
  (function pump(now) {
    if (!manual && now - lastTick >= TICK - 1) {
      lastTick = now - lastTick > TICK * 2 ? now : lastTick + TICK;
      runFrame(now);
    }
    native.raf(pump);
  })(native.perfNow());

  function enterManual() {
    manual = true;
    virtualStart = virtualNow = native.perfNow();
    dateAtStart = native.dateNow();
    timers = [];
  }

  function leaveManual() {
    const left = timers;
    const offset = virtualNow;
    manual = false;
    timers = [];
    lastTick = native.perfNow();
    // Timers still pending go back to real time with whatever delay they had left.
    for (const t of left) native.setTimeout(t.fn, Math.max(0, t.at - offset), ...t.args);
  }

  // Advances the clock by one step: due timers fire first, then animation frames, in the
  // same order a browser runs them.
  function step() {
    virtualNow += TICK;
    for (let guard = 0; guard < 10000; guard++) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > virtualNow) break;
      const t = timers.shift();
      try {
        t.fn(...t.args);
      } catch (err) {
        reportError(err);
      }
    }
    runFrame(virtualNow);
  }

  // Nothing is waiting on an animation frame or a timer.
  const idle = () => frameQueue.size === 0 && timers.length === 0;

  // Lets the page repaint without depending on rAF, which stops while minimized.
  const breathe = () =>
    new Promise((resolve) => {
      const done = () => resolve();
      native.raf(done);
      native.setTimeout(done, 30);
    });

  window.inkClock = {
    STEPS_PER_SECOND,
    native,
    enterManual,
    leaveManual,
    step,
    idle,
    breathe,
    get manual() {
      return manual;
    },
  };
})();
