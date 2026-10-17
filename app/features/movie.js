// Renders the whole movie frame by frame: every scene in order, the transition into each,
// the camera (features/camera.js, when on) and each scene's hold at the end. Used by the
// exporter (frames go to the video encoder) and the preview player (frames go to the screen).
//
// The animation runs on inkClock's manual clock: 60 steps per second, sampled at the
// requested frame rate, so the result is identical however fast the machine renders it.
(() => {
  const { STEPS_PER_SECOND } = inkClock;
  const MAX_SCENE_SECONDS = 60 * 60; // safety stop for an animation that never reports done

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Draws the transition from frame A (end of the previous scene) to frame B at progress p.
  function blend(c, A, B, type, p, W, H) {
    const e = ease(p);
    c.save();
    c.globalAlpha = 1;
    switch (type) {
      case "fade":
        c.drawImage(A, 0, 0);
        c.globalAlpha = e;
        c.drawImage(B, 0, 0);
        break;
      case "dip-white":
      case "dip-black": {
        c.drawImage(p < 0.5 ? A : B, 0, 0);
        c.fillStyle = type === "dip-white" ? "#ffffff" : "#000000";
        c.globalAlpha = p < 0.5 ? ease(p * 2) : 1 - ease((p - 0.5) * 2);
        c.fillRect(0, 0, W, H);
        break;
      }
      case "slide-left":
        c.drawImage(A, -e * W, 0);
        c.drawImage(B, W - e * W, 0);
        break;
      case "slide-right":
        c.drawImage(A, e * W, 0);
        c.drawImage(B, -W + e * W, 0);
        break;
      case "slide-up":
        c.drawImage(A, 0, -e * H);
        c.drawImage(B, 0, H - e * H);
        break;
      case "slide-down":
        c.drawImage(A, 0, e * H);
        c.drawImage(B, 0, -H + e * H);
        break;
      case "wipe-left":
        c.drawImage(A, 0, 0);
        c.beginPath();
        c.rect(W - e * W, 0, e * W, H);
        c.clip();
        c.drawImage(B, 0, 0);
        break;
      case "wipe-right":
        c.drawImage(A, 0, 0);
        c.beginPath();
        c.rect(0, 0, e * W, H);
        c.clip();
        c.drawImage(B, 0, 0);
        break;
      case "zoom-in": {
        // The old scene grows and fades away; the new one settles in from slightly smaller.
        const sb = 0.86 + 0.14 * e;
        c.drawImage(B, (W - W * sb) / 2, (H - H * sb) / 2, W * sb, H * sb);
        const sa = 1 + 0.6 * e;
        c.globalAlpha = 1 - e;
        c.drawImage(A, (W - W * sa) / 2, (H - H * sa) / 2, W * sa, H * sa);
        break;
      }
      case "zoom-out": {
        const sa = 1 - 0.14 * e;
        c.drawImage(A, (W - W * sa) / 2, (H - H * sa) / 2, W * sa, H * sa);
        const sb = 1.4 - 0.4 * e;
        c.globalAlpha = e;
        c.drawImage(B, (W - W * sb) / 2, (H - H * sb) / 2, W * sb, H * sb);
        break;
      }
      case "iris":
        c.drawImage(A, 0, 0);
        c.beginPath();
        c.arc(W / 2, H / 2, (e * Math.hypot(W, H)) / 2, 0, Math.PI * 2);
        c.clip();
        c.drawImage(B, 0, 0);
        break;
      default:
        c.drawImage(B, 0, 0);
    }
    c.restore();
  }

  // The live picture of the current scene: the drawing plus the hand, through the camera.
  function composeScene(c, W, H, time) {
    const mainCanvas = canvas;
    if (window.inkCamera?.enabled) {
      inkCamera.compose(c, mainCanvas, handCanvas, W, H, time);
    } else {
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, W, H);
      c.drawImage(mainCanvas, 0, 0, W, H);
      c.drawImage(handCanvas, 0, 0, W, H);
    }
  }

  function makeCanvas(W, H) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx2 = c.getContext("2d", { alpha: false });
    ctx2.imageSmoothingQuality = "high";
    return [c, ctx2];
  }

  /**
   * @param {object} o
   * @param {number} o.fps
   * @param {number} [o.width] output size (default: the canvas size). A smaller output than
   *   the canvas keeps camera close-ups sharp: e.g. a 4K canvas exported at 1080p.
   * @param {number} [o.height]
   * @param {(frame: HTMLCanvasElement, info: {index:number, time:number, scene:number}) => Promise<void>|void} o.onFrame
   * @param {(fraction: number, scene: number) => void} [o.onProgress]
   * @param {() => boolean} [o.cancelled]
   * @param {number} [o.from] first scene to render (default 0)
   * @param {number} [o.to] last scene to render (default: the last one)
   */
  async function renderMovie({ fps, width, height, onFrame, onProgress, cancelled = () => false, from = 0, to }) {
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    const W = even(width ?? state.canvasW);
    const H = even(height ?? state.canvasH);
    const [frame, fctx] = makeCanvas(W, H);
    const [sceneFrame, sctx2] = makeCanvas(W, H);
    const [prev, pctx] = makeCanvas(W, H);
    const scenes = inkScenes.list.slice(0, Math.min(inkScenes.list.length, (to ?? Infinity) + 1));
    const startScene = inkScenes.current;
    let index = 0;
    let steps = 0;
    const time = () => index / fps;

    const emit = async (sceneNo) => {
      await onFrame(frame, { index, time: time(), scene: sceneNo });
      index++;
    };
    // Advances the clock to the end of the current frame's time slot.
    const advance = (check) => {
      const until = Math.round(((index + 1) * STEPS_PER_SECOND) / fps);
      while (steps < until) {
        inkClock.step();
        steps++;
        check?.();
      }
    };

    state.recording = true;
    inkClock.enterManual();
    window.dispatchEvent(new CustomEvent("inkplainer:movie-start", { detail: { fps } }));
    try {
      for (let si = from; si < scenes.length; si++) {
        const scene = scenes[si];
        inkScenes.activate(si, { ui: false });
        window.inkCamera?.beginScene?.(scene, W, H);
        const hasContent = state.layers.some((l) => l.visible !== false);
        if (hasContent) {
          restartAnim();
          // Let generation start (it waits a couple of animation frames) so the first
          // frame shows the empty canvas, not the finished drawing.
          for (let i = 0; i < 12 && !(state.playing || state._activeSlots?.length); i++) inkClock.step();
        } else {
          state.bgCanvas = null;
          fillBg(ctx);
          hctx.clearRect(0, 0, state.canvasW, state.canvasH);
        }

        // Transition in, over the new scene's first (still) frame. Starting part-way, the
        // previous scene's finished picture stands in for its last frame.
        const tr = scene.transition;
        if (si === from && from > 0 && tr && tr.type !== "cut") {
          pctx.drawImage(inkScenes.picture(from - 1, state.canvasH), 0, 0, W, H);
        }
        if (si > 0 && tr && tr.type !== "cut" && tr.duration > 0) {
          const n = Math.max(1, Math.round(tr.duration * fps));
          composeScene(sctx2, W, H, time());
          for (let f = 0; f < n; f++) {
            if (cancelled()) throw new Error("Cancelled");
            blend(fctx, prev, sceneFrame, tr.type, (f + 1) / n, W, H);
            await emit(si);
          }
        }

        // The scene itself: draw until the animation completes, then hold.
        let started = !hasContent;
        let complete = !hasContent;
        let idleSteps = 0;
        let hold = Math.max(1, Math.round((scene.hold ?? 1) * fps));
        const sceneStart = index;
        const check = () => {
          if (!hasContent) return;
          if (!state.done) started = true;
          complete = started && isExportAnimationComplete();
          if (!complete && !state.playing && !state.done && inkClock.idle()) {
            if (++idleSteps > STEPS_PER_SECOND * 2) complete = true; // nothing left to animate
          } else {
            idleSteps = 0;
          }
        };
        for (;;) {
          if (cancelled()) throw new Error("Cancelled");
          advance(check);
          composeScene(sctx2, W, H, time());
          fctx.drawImage(sceneFrame, 0, 0);
          await emit(si);
          if (complete && --hold <= 0) break;
          if (index - sceneStart > MAX_SCENE_SECONDS * fps) break;
          if (index % 4 === 0) {
            const within = complete ? 1 : getExportAnimationProgress();
            onProgress?.((si - from + within) / (scenes.length - from), si);
          }
        }
        pctx.drawImage(sceneFrame, 0, 0);
        window.inkCamera?.endScene?.();
      }
      onProgress?.(1, scenes.length - 1);
    } finally {
      inkClock.leaveManual();
      state.recording = false;
      window.dispatchEvent(new CustomEvent("inkplainer:movie-end"));
      resetAnim();
      inkScenes.activate(startScene, { ui: true, force: true });
    }
    return { frames: index, width: W, height: H };
  }

  window.inkMovie = { render: renderMovie, blend };
})();
