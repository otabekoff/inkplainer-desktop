// Starter templates for the gallery (features/templates.js): complete multi-scene videos
// that show off what the app does: scenes and transitions, the camera, drawing styles,
// entrances, handwriting, backgrounds. Coordinates are for a 1920×1080 canvas.
//
// Illustrations are SVG. SVG images cannot use the page's web fonts, so any text inside
// them uses fonts Windows always has (Segoe UI, Consolas); headings are text layers instead.
(() => {
  const svg = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const UI = "Segoe UI, Arial, sans-serif";
  const MONO = "Consolas, 'Cascadia Mono', monospace";

  // ── Shared pieces ─────────────────────────────────────────────────────────
  // A code editor card. lines: arrays of [text, colour] tokens.
  function codeCard(w, lines, title = "loops.ts") {
    const lh = 54;
    const h = 96 + lines.length * lh + 30;
    const rows = lines
      .map((tokens, i) => {
        const spans = tokens.map(([t, c]) => `<tspan fill="${c}">${esc(t)}</tspan>`).join("");
        return `<text x="${86}" y="${120 + i * lh}" font-family="${MONO}" font-size="34" xml:space="preserve">${spans}</text>` +
          `<text x="${40}" y="${120 + i * lh}" font-family="${MONO}" font-size="26" fill="#4b5263" text-anchor="middle">${i + 1}</text>`;
      })
      .join("");
    return svg(w, h, `
      <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="22" fill="#1e2130" stroke="#2c3145" stroke-width="2"/>
      <circle cx="40" cy="38" r="9" fill="#ff5f57"/><circle cx="68" cy="38" r="9" fill="#febc2e"/><circle cx="96" cy="38" r="9" fill="#28c840"/>
      <text x="${w / 2}" y="46" font-family="${UI}" font-size="22" fill="#8b93a7" text-anchor="middle">${esc(title)}</text>
      <line x1="4" y1="70" x2="${w - 4}" y2="70" stroke="#2c3145" stroke-width="2"/>
      ${rows}`);
  }
  const K = "#c792ea", V = "#82aaff", N = "#f78c6c", S = "#c3e88d", P = "#cdd3de", F = "#ffcb6b", C = "#697098";

  // A hand-drawn style arrow from (x1,y1) to (x2,y2), curving by `bend`.
  function arrow(w, h, x1, y1, x2, y2, color = "#e5484d", bend = 0.25, width = 7) {
    const mx = (x1 + x2) / 2 - (y2 - y1) * bend;
    const my = (y1 + y2) / 2 + (x2 - x1) * bend;
    const a = Math.atan2(y2 - my, x2 - mx);
    const hx1 = x2 - 30 * Math.cos(a - 0.45), hy1 = y2 - 30 * Math.sin(a - 0.45);
    const hx2 = x2 - 30 * Math.cos(a + 0.45), hy2 = y2 - 30 * Math.sin(a + 0.45);
    return svg(w, h, `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}"/><path d="M${hx1} ${hy1} L${x2} ${y2} L${hx2} ${hy2}"/></g>`);
  }

  function pill(w, h, label, fill, stroke, color = "#1f2937", size = 40) {
    return svg(w, h, `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="${Math.min(h / 2 - 4, 34)}" fill="${fill}" stroke="${stroke}" stroke-width="6"/>
      <text x="${w / 2}" y="${h / 2 + size * 0.36}" font-family="${UI}" font-weight="600" font-size="${size}" fill="${color}" text-anchor="middle">${esc(label)}</text>`);
  }

  // ── Loops in TypeScript ───────────────────────────────────────────────────
  const tsBadge = svg(260, 260, `
    <rect x="6" y="6" width="248" height="248" rx="40" fill="#3178c6"/>
    <text x="226" y="226" font-family="${UI}" font-weight="700" font-size="120" fill="#fff" text-anchor="end">TS</text>`);
  const loopIcon = svg(300, 300, `<g fill="none" stroke="#1f2937" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">
    <path d="M70 150a80 80 0 0 1 136-57"/><path d="M200 50l8 44-44 8"/>
    <path d="M230 150a80 80 0 0 1-136 57"/><path d="M100 250l-8-44 44-8"/></g>
    <circle cx="150" cy="150" r="18" fill="#3178c6"/>`);
  const forCode = codeCard(1000, [
    [["for", K], [" (", P], ["let", K], [" i ", V], ["=", P], [" 0", N], ["; ", P], ["i ", V], ["<", P], [" 3", N], ["; ", P], ["i", V], ["++", P], [") {", P]],
    [["  console", V], [".", P], ["log", F], ["(", P], ["`Step ${i}`", S], [");", P]],
    [["}", P]],
  ]);
  const forOfCode = codeCard(1000, [
    [["const", K], [" fruits ", V], ["= [", P], ["\"apple\"", S], [", ", P], ["\"pear\"", S], ["];", P]],
    [["", P]],
    [["for", K], [" (", P], ["const", K], [" fruit ", V], ["of", K], [" fruits", V], [") {", P]],
    [["  console", V], [".", P], ["log", F], ["(fruit);", P]],
    [["}", P]],
  ], "for-of.ts");
  const terminal = svg(760, 420, `
    <rect x="4" y="4" width="752" height="412" rx="22" fill="#0f1117" stroke="#262a36" stroke-width="2"/>
    <circle cx="40" cy="38" r="9" fill="#ff5f57"/><circle cx="68" cy="38" r="9" fill="#febc2e"/><circle cx="96" cy="38" r="9" fill="#28c840"/>
    <text x="380" y="46" font-family="${UI}" font-size="22" fill="#7b8396" text-anchor="middle">Terminal</text>
    <text x="40" y="124" font-family="${MONO}" font-size="34" fill="#7ee787">&gt; <tspan fill="#e6edf3">npx tsx loops.ts</tspan></text>`);
  const check = svg(160, 160, `<circle cx="80" cy="80" r="70" fill="#dcfce7" stroke="#16a34a" stroke-width="8"/>
    <path d="M48 82l22 22 44-48" fill="none" stroke="#16a34a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`);

  // ── A book, explained ─────────────────────────────────────────────────────
  const book = svg(560, 400, `<g stroke="#3b2a1a" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
    <path d="M280 70C220 40 120 36 40 60v290c80-24 180-20 240 10z" fill="#fffaf0"/>
    <path d="M280 70c60-30 160-34 240-10v290c-80-24-180-20-240 10z" fill="#fff4dc"/>
    <path d="M280 70v290" fill="none"/>
    <g fill="none" stroke-width="5" opacity="0.6"><path d="M90 120c50-10 110-8 150 6M90 170c50-10 110-8 150 6M90 220c50-10 110-8 150 6M90 270c40-8 90-6 120 4"/>
    <path d="M320 126c40-14 100-16 150-6M320 176c40-14 100-16 150-6M320 226c40-14 100-16 150-6"/></g></g>
    <path d="M400 60v120l26-20 26 20V60" fill="#e5484d" stroke="#3b2a1a" stroke-width="6" stroke-linejoin="round"/>`);
  const target = svg(320, 320, `<g fill="none" stroke-width="16"><circle cx="160" cy="160" r="130" stroke="#e5484d"/><circle cx="160" cy="160" r="84" stroke="#3b2a1a"/><circle cx="160" cy="160" r="38" stroke="#e5484d"/></g>
    <path d="M160 160l120-120" stroke="#3b2a1a" stroke-width="12" stroke-linecap="round"/><path d="M250 30l40 0 0 40" fill="none" stroke="#3b2a1a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`);
  const clock = svg(320, 320, `<circle cx="160" cy="170" r="130" fill="#fff4dc" stroke="#3b2a1a" stroke-width="14"/>
    <path d="M160 92v78l54 34" fill="none" stroke="#e5484d" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <g stroke="#3b2a1a" stroke-width="10" stroke-linecap="round"><path d="M160 52v18M160 270v18M42 170h18M260 170h18"/></g>
    <path d="M70 30l-40 40M250 30l40 40" stroke="#3b2a1a" stroke-width="14" stroke-linecap="round"/>`);
  const moonCup = svg(360, 320, `<path d="M150 40a110 110 0 1 0 120 150A86 86 0 0 1 150 40z" fill="#fde68a" stroke="#3b2a1a" stroke-width="12" stroke-linejoin="round"/>
    <g fill="#fff4dc" stroke="#3b2a1a" stroke-width="10" stroke-linejoin="round"><path d="M190 200h120v50a50 50 0 0 1-50 50h-20a50 50 0 0 1-50-50z"/><path d="M310 216h14a22 22 0 0 1 0 44h-16" fill="none"/></g>
    <path d="M230 170c-10-14 10-22 0-38M268 170c-10-14 10-22 0-38" fill="none" stroke="#3b2a1a" stroke-width="8" stroke-linecap="round"/>`);
  const quoteMarks = svg(220, 170, `<g fill="#e5484d"><path d="M20 160c0-70 20-120 80-150l16 22c-30 20-42 46-44 70h40v58z"/><path d="M120 160c0-70 20-120 80-150l16 22c-30 20-42 46-44 70h40v58z"/></g>`);
  const checklist = svg(560, 300, `<g fill="none" stroke="#3b2a1a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <rect x="20" y="30" width="60" height="60" rx="10"/><path d="M34 60l14 14 26-30" stroke="#16a34a"/>
    <rect x="20" y="130" width="60" height="60" rx="10"/><path d="M34 160l14 14 26-30" stroke="#16a34a"/>
    <rect x="20" y="230" width="60" height="60" rx="10"/><path d="M34 260l14 14 26-30" stroke="#16a34a"/></g>`);

  // ── The water cycle ───────────────────────────────────────────────────────
  const droplet = svg(240, 320, `<path d="M120 20C80 90 30 150 30 210a90 90 0 0 0 180 0c0-60-50-120-90-190z" fill="#38bdf8" stroke="#0c4a6e" stroke-width="10" stroke-linejoin="round"/>
    <path d="M80 210a40 40 0 0 0 40 40" fill="none" stroke="#e0f2fe" stroke-width="12" stroke-linecap="round"/>`);
  const sun = svg(300, 300, `<circle cx="150" cy="150" r="70" fill="#fbbf24" stroke="#b45309" stroke-width="8"/>
    <g stroke="#f59e0b" stroke-width="12" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315]
      .map((a) => { const r = (a * Math.PI) / 180; return `<line x1="${150 + Math.cos(r) * 98}" y1="${150 + Math.sin(r) * 98}" x2="${150 + Math.cos(r) * 136}" y2="${150 + Math.sin(r) * 136}"/>`; })
      .join("")}</g>`);
  const sea = svg(900, 300, `<path d="M0 90c75-40 150-40 225 0s150 40 225 0 150-40 225 0 150 40 225 0V300H0z" fill="#38bdf8" stroke="#0369a1" stroke-width="8" stroke-linejoin="round"/>
    <g fill="none" stroke="#e0f2fe" stroke-width="8" stroke-linecap="round"><path d="M80 170c40-20 80-20 120 0M380 210c40-20 80-20 120 0M640 160c40-20 80-20 120 0"/></g>`);
  const mountain = svg(820, 560, `<path d="M20 540L330 90l120 150 90-110 260 410z" fill="#a3e635" stroke="#3f6212" stroke-width="10" stroke-linejoin="round"/>
    <path d="M330 90l-64 92 34 26 36-36 38 30 36-30z" fill="#fff" stroke="#3f6212" stroke-width="8" stroke-linejoin="round"/>
    <path d="M540 130l-40 58 28 20 22-24 26 18 22-24z" fill="#fff" stroke="#3f6212" stroke-width="8" stroke-linejoin="round"/>`);
  const cloud = svg(460, 300, `<path transform="translate(0 38)" d="M110 220a80 80 0 0 1-10-158 110 110 0 0 1 206-20 86 86 0 0 1 114 82 70 70 0 0 1-30 96z" fill="#f8fafc" stroke="#475569" stroke-width="10" stroke-linejoin="round"/>`);
  const rain = svg(360, 300, `<g stroke="#0284c7" stroke-width="10" stroke-linecap="round">${[[40, 20], [110, 60], [180, 10], [250, 50], [320, 20], [75, 150], [145, 180], [215, 140], [285, 170]]
    .map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x - 22}" y2="${y + 70}"/>`).join("")}</g>`);
  const river = svg(700, 420, `<path d="M664 32c-80 60-40 120-160 150s-120 120-260 150S80 388 24 396" fill="none" stroke="#0ea5e9" stroke-width="30" stroke-linecap="round"/>
    <path d="M664 32c-80 60-40 120-160 150s-120 120-260 150S80 388 24 396" fill="none" stroke="#e0f2fe" stroke-width="8" stroke-linecap="round" stroke-dasharray="20 34"/>`);
  const vapor = svg(320, 360, `<g fill="none" stroke="#f97316" stroke-width="10" stroke-linecap="round">
    <path d="M60 340c-30-40 30-70 0-110s30-70 0-110"/><path d="M160 340c-30-40 30-70 0-110s30-70 0-110s30-70 0-90"/><path d="M260 340c-30-40 30-70 0-110s30-70 0-110"/>
    <path d="M40 140l20-28 20 28M140 50l20-28 20 28M240 140l20-28 20 28"/></g>`);
  const cycleRing = svg(760, 760, `<g fill="none" stroke="#0369a1" stroke-width="12" stroke-linecap="round">
    <path d="M380 70a310 310 0 0 1 300 230"/><path d="M690 380a310 310 0 0 1-230 300"/><path d="M380 690a310 310 0 0 1-300-230"/><path d="M70 380a310 310 0 0 1 230-300"/></g>
    <g fill="#0369a1">${[[680, 300, 70], [460, 680, 160], [80, 460, 250], [300, 80, 340]].map(([x, y, a]) =>
      `<path d="M0 -18L30 0L0 18z" transform="translate(${x} ${y}) rotate(${a})"/>`).join("")}</g>`);

  // ── Startup pitch (chalk on a blackboard) ────────────────────────────────
  const chalk = "#f8fafc";
  const rocket = svg(360, 460, `<g fill="none" stroke="${chalk}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round">
    <path d="M180 20c70 60 90 170 60 270H120C90 190 110 80 180 20z"/><circle cx="180" cy="150" r="34"/>
    <path d="M120 230l-60 80 66-10M240 230l60 80-66-10"/><path d="M150 300c-6 40 6 80 30 120 24-40 36-80 30-120" stroke="#fbbf24"/></g>`);
  const tangle = svg(560, 360, `<path d="M40 180c60-160 140 140 200 0s-160-120-80 40 220 120 260-20-180-160-140 20 200 100 240-60M60 300c120-40 200 40 320-10" fill="none" stroke="${chalk}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="460" cy="70" r="40" fill="none" stroke="#f87171" stroke-width="8"/><path d="M432 98l56-56" stroke="#f87171" stroke-width="8" stroke-linecap="round"/>`);
  const flowStep = (label) => svg(380, 170, `<rect x="6" y="6" width="368" height="158" rx="26" fill="none" stroke="${chalk}" stroke-width="8"/>
    <text x="190" y="102" font-family="${UI}" font-size="44" font-weight="600" fill="${chalk}" text-anchor="middle">${esc(label)}</text>`);
  const flowArrow = svg(160, 80, `<g fill="none" stroke="#fbbf24" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 40h130M110 12l30 28-30 28"/></g>`);
  const axis = svg(1100, 612, `<g fill="none" stroke="${chalk}" stroke-width="8" stroke-linecap="round"><path d="M60 20v540h1020"/></g>
    <g font-family="${UI}" font-size="34" fill="${chalk}" text-anchor="middle"><text x="230" y="596">Jan</text><text x="470" y="596">Feb</text><text x="710" y="596">Mar</text><text x="950" y="596">Apr</text></g>`);
  const bar = (h, color) => svg(150, h, `<rect x="6" y="6" width="138" height="${h - 12}" rx="10" fill="${color}" fill-opacity="0.85" stroke="${chalk}" stroke-width="6"/>`);
  const burst = svg(300, 300, `<g stroke="#fbbf24" stroke-width="12" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => {
    const r = (i * 30 * Math.PI) / 180; return `<line x1="${150 + Math.cos(r) * 60}" y1="${150 + Math.sin(r) * 60}" x2="${150 + Math.cos(r) * (i % 2 ? 110 : 140)}" y2="${150 + Math.sin(r) * (i % 2 ? 110 : 140)}"/>`; }).join("")}</g>
    <circle cx="150" cy="150" r="34" fill="none" stroke="${chalk}" stroke-width="10"/>`);

  // ── Layer helpers ─────────────────────────────────────────────────────────
  const img = (art, x, y, w, h, o = {}) => ({ type: "image", art, x, y, w, h, ...o });
  const text = (value, x, y, o = {}) => ({ type: "text", text: value, x, y, ...o });
  const title = (value, x, y, o = {}) => text(value, x, y, { font: "Caveat", size: 128, bold: true, anim: "spec-text", speed: 68, ...o });

  window.INK_TEMPLATES = [
    {
      id: "ts-loops",
      title: "Loops in TypeScript",
      desc: "A coding lesson: code cards, a loop diagram and terminal output, with the camera following along.",
      tags: ["Education", "Code"],
      scenes: [
        { name: "Title", bg: "dots", camera: { mode: "off" }, hold: 1.2, layers: [
          img(tsBadge, 300, 330, 260, 260, { anim: "enter-pop", speed: 55 }),
          title("Loops in TypeScript", 640, 360, { color: "#1f2937" }),
          text("Repeat work without repeating code", 650, 540, { font: "Patrick Hand", size: 58, color: "#3178c6", anim: "spec-text", speed: 78 }),
          img(loopIcon, 1520, 640, 240, 240, { anim: "svg-draw", speed: 69 }),
        ] },
        { name: "The for loop", bg: "dots", transition: { type: "slide-left", duration: 0.9 }, camera: { mode: "follow", zoom: 1.6 }, hold: 1.5, layers: [
          title("The classic for loop", 160, 90, { size: 96, color: "#1f2937" }),
          img(forCode, 460, 300, 1000, 288, { anim: "svg-draw", speed: 70, camera: "wide" }),
          img(arrow(300, 200, 260, 190, 40, 20), 470, 600, 300, 200, { anim: "svg-draw", speed: 84 }),
          text("start", 380, 800, { font: "Caveat", size: 70, color: "#e5484d", anim: "spec-text", speed: 88 }),
          img(arrow(300, 200, 150, 190, 150, 20, "#e5484d", 0), 760, 600, 300, 200, { anim: "svg-draw", speed: 84 }),
          text("keep going while true", 700, 800, { font: "Caveat", size: 70, color: "#e5484d", anim: "spec-text", speed: 88 }),
          img(arrow(300, 200, 40, 190, 260, 20), 1110, 600, 300, 200, { anim: "svg-draw", speed: 84 }),
          text("then add 1", 1330, 800, { font: "Caveat", size: 70, color: "#e5484d", anim: "spec-text", speed: 88 }),
        ] },
        { name: "How it runs", bg: "dots", transition: { type: "slide-left", duration: 0.9 }, camera: { mode: "follow", zoom: 1.5 }, hold: 1.5, layers: [
          title("Step by step", 160, 80, { size: 96, color: "#1f2937" }),
          img(pill(360, 140, "i = 0", "#dbeafe", "#3178c6"), 200, 470, 360, 140, { anim: "enter-pop", speed: 60 }),
          img(arrow(220, 120, 10, 60, 210, 60, "#1f2937", 0, 8), 580, 480, 220, 120, { anim: "svg-draw", speed: 89 }),
          img(pill(380, 140, "i < 3 ?", "#fef3c7", "#d97706"), 820, 470, 380, 140, { anim: "enter-pop", speed: 60 }),
          img(arrow(220, 120, 10, 60, 210, 60, "#1f2937", 0, 8), 1220, 480, 220, 120, { anim: "svg-draw", speed: 89 }),
          img(pill(380, 140, "log step", "#dcfce7", "#16a34a"), 1460, 470, 380, 140, { anim: "enter-pop", speed: 60 }),
          img(arrow(1200, 260, 1100, 20, 120, 20, "#3178c6", -0.12, 8), 520, 640, 1200, 260, { anim: "svg-draw", speed: 79 }),
          text("i++ and check again", 830, 880, { font: "Patrick Hand", size: 60, color: "#3178c6", anim: "spec-text", speed: 83 }),
          text("false? the loop ends", 860, 300, { font: "Patrick Hand", size: 56, color: "#d97706", anim: "spec-text", speed: 83 }),
        ] },
        { name: "Output", bg: "dots", transition: { type: "fade", duration: 0.8 }, camera: { mode: "follow", zoom: 1.4 }, hold: 1.2, layers: [
          title("What it prints", 160, 80, { size: 96, color: "#1f2937" }),
          img(terminal, 580, 300, 760, 420, { anim: "enter-fade", speed: 60, camera: "wide" }),
          text("Step 0", 640, 470, { font: "Space Mono", size: 44, color: "#7ee787", anim: "enter-fade", speed: 80 }),
          text("Step 1", 640, 540, { font: "Space Mono", size: 44, color: "#7ee787", anim: "enter-fade", speed: 80 }),
          text("Step 2", 640, 610, { font: "Space Mono", size: 44, color: "#7ee787", anim: "enter-fade", speed: 80 }),
          img(check, 1400, 560, 160, 160, { anim: "enter-pop", speed: 60 }),
        ] },
        { name: "for…of", bg: "dots", transition: { type: "zoom-in", duration: 1 }, camera: { mode: "off" }, hold: 2, layers: [
          title("Looping over a list", 160, 80, { size: 96, color: "#1f2937" }),
          img(forOfCode, 160, 280, 1000, 396, { anim: "svg-draw", speed: 65 }),
          text("for → count", 1260, 330, { font: "Patrick Hand", size: 62, color: "#1f2937", anim: "spec-text", speed: 83 }),
          text("for…of → each item", 1260, 440, { font: "Patrick Hand", size: 62, color: "#1f2937", anim: "spec-text", speed: 83 }),
          text("while → until done", 1260, 550, { font: "Patrick Hand", size: 62, color: "#1f2937", anim: "spec-text", speed: 83 }),
          text("Now try it yourself!", 640, 840, { font: "Caveat", size: 96, bold: true, color: "#3178c6", anim: "spec-text", speed: 73 }),
        ] },
      ],
    },
    {
      id: "book-explained",
      title: "A Book, Explained",
      desc: "A book summary in five scenes: the big ideas, a quote and who should read it. Swap in your own book.",
      tags: ["Summary", "Storytelling"],
      scenes: [
        { name: "The book", bg: "cream", camera: { mode: "off" }, hold: 1.2, layers: [
          img(book, 1160, 300, 560, 400, { anim: "svg-draw", speed: 59, outlineStrokeStyle: "charcoal" }),
          title("The Little Book", 200, 320, { color: "#3b2a1a", size: 120 }),
          title("of Focus", 200, 470, { color: "#3b2a1a", size: 120 }),
          text("by A. Writer · explained in one minute", 210, 680, { font: "Patrick Hand", size: 54, color: "#7c5a3a", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Idea 1", bg: "cream", transition: { type: "dip-white", duration: 0.9 }, camera: { mode: "follow", zoom: 1.4 }, hold: 1.2, layers: [
          text("Big idea #1", 220, 160, { font: "Patrick Hand", size: 60, color: "#e5484d", anim: "spec-text", speed: 78 }),
          title("Do one thing at a time", 220, 260, { color: "#3b2a1a", size: 104 }),
          img(target, 1300, 420, 320, 320, { anim: "svg-draw", speed: 59 }),
          text("Switching tasks costs more", 230, 560, { font: "Patrick Hand", size: 60, color: "#3b2a1a", anim: "spec-text", speed: 78 }),
          text("than it feels like.", 230, 650, { font: "Patrick Hand", size: 60, color: "#3b2a1a", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Idea 2", bg: "cream", transition: { type: "dip-white", duration: 0.9 }, camera: { mode: "follow", zoom: 1.4 }, hold: 1.2, layers: [
          text("Big idea #2", 220, 160, { font: "Patrick Hand", size: 60, color: "#e5484d", anim: "spec-text", speed: 78 }),
          title("Protect your deep hours", 220, 260, { color: "#3b2a1a", size: 104 }),
          img(clock, 1300, 420, 320, 320, { anim: "svg-draw", speed: 59 }),
          text("Put the hard work first,", 230, 560, { font: "Patrick Hand", size: 60, color: "#3b2a1a", anim: "spec-text", speed: 78 }),
          text("before the inbox wakes up.", 230, 650, { font: "Patrick Hand", size: 60, color: "#3b2a1a", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Idea 3", bg: "cream", transition: { type: "dip-white", duration: 0.9 }, camera: { mode: "follow", zoom: 1.4 }, hold: 1.2, layers: [
          text("Big idea #3", 220, 160, { font: "Patrick Hand", size: 60, color: "#e5484d", anim: "spec-text", speed: 78 }),
          title("Rest is part of the work", 220, 260, { color: "#3b2a1a", size: 104 }),
          img(moonCup, 1280, 420, 360, 320, { anim: "svg-draw", speed: 59 }),
          text("Breaks refill attention;", 230, 560, { font: "Patrick Hand", size: 60, color: "#3b2a1a", anim: "spec-text", speed: 78 }),
          text("skipping them drains it.", 230, 650, { font: "Patrick Hand", size: 60, color: "#3b2a1a", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Takeaway", bg: "cream", transition: { type: "fade", duration: 1 }, camera: { mode: "off" }, hold: 2.2, layers: [
          img(quoteMarks, 220, 150, 220, 170, { anim: "enter-pop", speed: 55 }),
          title("Focus is saying no.", 480, 190, { color: "#3b2a1a", size: 120 }),
          text("Read it if…", 230, 470, { font: "Caveat", size: 84, bold: true, color: "#e5484d", anim: "spec-text", speed: 78 }),
          img(checklist, 230, 580, 560, 300, { anim: "svg-draw", speed: 69 }),
          text("you feel busy but not productive", 350, 600, { font: "Patrick Hand", size: 56, color: "#3b2a1a", anim: "spec-text", speed: 83 }),
          text("your days vanish into meetings", 350, 700, { font: "Patrick Hand", size: 56, color: "#3b2a1a", anim: "spec-text", speed: 83 }),
          text("you want calmer, deeper work", 350, 800, { font: "Patrick Hand", size: 56, color: "#3b2a1a", anim: "spec-text", speed: 83 }),
        ] },
      ],
    },
    {
      id: "water-cycle",
      title: "The Water Cycle",
      desc: "A science explainer: a landscape drawn piece by piece while the camera follows evaporation, clouds, rain and rivers.",
      tags: ["Science", "Kids"],
      scenes: [
        { name: "Title", bg: "sky", camera: { mode: "off" }, hold: 1.2, layers: [
          img(droplet, 300, 380, 240, 320, { anim: "svg-draw", speed: 64 }),
          title("The Water Cycle", 620, 380, { color: "#0c4a6e", size: 140 }),
          text("Where does rain come from?", 640, 580, { font: "Patrick Hand", size: 64, color: "#0369a1", anim: "spec-text", speed: 78 }),
        ] },
        { name: "The journey", bg: "sky", transition: { type: "wipe-left", duration: 1 }, camera: { mode: "follow", zoom: 1.8 }, hold: 1.8, layers: [
          img(sea, 0, 780, 900, 300, { anim: "svg-draw", speed: 69, camera: "wide" }),
          img(mountain, 1100, 520, 820, 560, { anim: "svg-draw", speed: 69 }),
          img(sun, 120, 80, 300, 300, { anim: "svg-draw", speed: 69 }),
          img(vapor, 300, 440, 320, 360, { anim: "svg-draw", speed: 74 }),
          text("1. Evaporation", 140, 380, { font: "Patrick Hand", size: 58, color: "#c2410c", anim: "spec-text", speed: 83 }),
          img(cloud, 760, 60, 460, 300, { anim: "svg-draw", speed: 69 }),
          text("2. Condensation", 800, 360, { font: "Patrick Hand", size: 58, color: "#334155", anim: "spec-text", speed: 83 }),
          img(rain, 1180, 300, 360, 300, { anim: "svg-draw", speed: 79 }),
          text("3. Precipitation", 1450, 260, { font: "Patrick Hand", size: 58, color: "#0369a1", anim: "spec-text", speed: 83 }),
          img(river, 600, 640, 700, 420, { anim: "svg-draw", speed: 74 }),
          text("4. Collection", 920, 700, { font: "Patrick Hand", size: 58, color: "#0369a1", anim: "spec-text", speed: 83 }),
        ] },
        { name: "Round and round", bg: "sky", transition: { type: "iris", duration: 1.1 }, camera: { mode: "off" }, hold: 2.2, layers: [
          img(cycleRing, 580, 160, 760, 760, { anim: "svg-draw", speed: 69 }),
          img(sun, 860, 60, 200, 200, { anim: "enter-pop", speed: 60 }),
          img(cloud, 1340, 430, 280, 183, { anim: "enter-pop", speed: 60 }),
          img(rain, 870, 830, 180, 150, { anim: "enter-pop", speed: 60 }),
          img(droplet, 360, 420, 150, 200, { anim: "enter-pop", speed: 60 }),
          title("It never stops!", 760, 470, { color: "#0c4a6e", size: 96 }),
        ] },
      ],
    },
    {
      id: "startup-pitch",
      title: "Startup Pitch",
      desc: "A 30-second pitch in chalk: problem, solution, traction chart and a call to action.",
      tags: ["Business", "Marketing"],
      scenes: [
        { name: "Hello", bg: "chalk", camera: { mode: "off" }, hold: 1.2, hand: "custom3", layers: [
          img(rocket, 1300, 280, 360, 460, { anim: "svg-draw", speed: 64 }),
          title("Meet TaskFlow", 220, 360, { color: "#f8fafc", size: 140, font: "Permanent Marker", bold: false }),
          text("Busywork, handled.", 230, 560, { font: "Caveat", size: 84, color: "#fbbf24", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Problem", bg: "chalk", transition: { type: "slide-up", duration: 0.9 }, camera: { mode: "follow", zoom: 1.5 }, hold: 1.3, hand: "custom3", layers: [
          text("The problem", 220, 140, { font: "Permanent Marker", size: 92, color: "#f87171", anim: "spec-text", speed: 78 }),
          img(tangle, 1120, 300, 560, 360, { anim: "svg-draw", speed: 69 }),
          text("Teams lose 5 hours", 230, 380, { font: "Caveat", size: 96, bold: true, color: "#f8fafc", anim: "spec-text", speed: 78 }),
          text("every week to busywork.", 230, 500, { font: "Caveat", size: 96, bold: true, color: "#f8fafc", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Solution", bg: "chalk", transition: { type: "slide-up", duration: 0.9 }, camera: { mode: "follow", zoom: 1.4 }, hold: 1.3, hand: "custom3", layers: [
          text("The solution", 220, 140, { font: "Permanent Marker", size: 92, color: "#4ade80", anim: "spec-text", speed: 78 }),
          img(flowStep("Connect"), 160, 460, 380, 170, { anim: "enter-move", speed: 60, enterFrom: "left" }),
          img(flowArrow, 570, 505, 160, 80, { anim: "svg-draw", speed: 89 }),
          img(flowStep("Automate"), 770, 460, 380, 170, { anim: "enter-move", speed: 60, enterFrom: "bottom" }),
          img(flowArrow, 1180, 505, 160, 80, { anim: "svg-draw", speed: 89 }),
          img(flowStep("Relax"), 1380, 460, 380, 170, { anim: "enter-move", speed: 60, enterFrom: "right" }),
        ] },
        { name: "Traction", bg: "chalk", transition: { type: "slide-up", duration: 0.9 }, camera: { mode: "off" }, hold: 1.4, hand: "custom3", layers: [
          text("Traction", 220, 110, { font: "Permanent Marker", size: 92, color: "#fbbf24", anim: "spec-text", speed: 78 }),
          img(axis, 400, 300, 1100, 612, { anim: "svg-draw", speed: 79 }),
          img(bar(160, "#60a5fa"), 555, 700, 150, 160, { anim: "enter-drop", speed: 65 }),
          img(bar(260, "#60a5fa"), 795, 600, 150, 260, { anim: "enter-drop", speed: 65 }),
          img(bar(380, "#60a5fa"), 1035, 480, 150, 380, { anim: "enter-drop", speed: 65 }),
          img(bar(520, "#4ade80"), 1275, 340, 150, 520, { anim: "enter-drop", speed: 65 }),
          text("+40% every month", 1150, 170, { font: "Caveat", size: 84, bold: true, color: "#4ade80", anim: "spec-text", speed: 78 }),
        ] },
        { name: "Call to action", bg: "chalk", transition: { type: "zoom-out", duration: 1 }, camera: { mode: "off" }, hold: 2.2, hand: "custom3", layers: [
          img(burst, 810, 120, 300, 300, { anim: "enter-pop", speed: 55 }),
          title("Join the beta", 560, 470, { color: "#f8fafc", size: 140, font: "Permanent Marker", bold: false }),
          text("taskflow.example", 700, 680, { font: "Caveat", size: 90, bold: true, color: "#fbbf24", anim: "spec-text", speed: 78 }),
        ] },
      ],
    },
  ];
})();
