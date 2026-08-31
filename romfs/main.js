// src/main.ts
var LOG = "sdmc:/switch/swkbd-leak-repro.log";
var boot = Date.now();
var lines = [];
function log(line) {
  const msg = `${((Date.now() - boot) / 1e3).toFixed(2)}s ${line}`;
  try {
    Switch.appendFileSync(LOG, msg + "\n");
  } catch {
  }
  lines.push(msg);
  if (lines.length > 20) lines.shift();
}
var ctx = screen.getContext("2d");
var vk = navigator.virtualKeyboard;
var vkUp = false;
var hiddenAt = 0;
var opens = 0;
var changes = 0;
var frames = 0;
function render() {
  const inset = vk?.boundingRect?.height ?? 0;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, screen.width, screen.height);
  ctx.fillStyle = "#4ade80";
  ctx.font = '22px "Geist Mono", monospace';
  ctx.textBaseline = "top";
  ctx.fillText(`swkbd-leak-repro  opens=${opens} changes=${changes}`, 14, 12);
  ctx.fillStyle = "#94a3b8";
  ctx.font = '18px "Geist Mono", monospace';
  ctx.fillText("X/tap: keyboard   Minus: clean exit   (+ with keyboard open = submit, twice = leak exit)", 14, 42);
  ctx.fillStyle = "#e2e8f0";
  lines.forEach((l, i) => ctx.fillText(l.slice(0, 110), 14, 80 + i * 24));
  const by = screen.height - inset - 40;
  ctx.fillStyle = "#10161d";
  ctx.fillRect(0, by, screen.width, 40);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(vkUp ? `> ${String(vk?.value ?? "")}` : "idle \u2014 press X", 14, by + 8);
}
function open() {
  if (!vk || vkUp || Date.now() - hiddenAt < 700) return;
  vk.type = 0;
  vk.okButtonText = "Send";
  vk.maxLength = 200;
  vk.value = "";
  try {
    vk.cursorIndex = 0;
  } catch {
  }
  vk.show();
  vkUp = true;
  opens++;
  log(`show #${opens} rect h=${vk.boundingRect?.height ?? "?"}`);
}
if (vk) {
  vk.addEventListener("change", () => {
    changes++;
    log(`change #${changes} len=${String(vk.value ?? "").length}`);
  });
  vk.addEventListener("submit", () => {
    vkUp = false;
    hiddenAt = Date.now();
    log(`submit "${String(vk.value ?? "").slice(0, 40)}"`);
  });
  vk.addEventListener("cancel", () => {
    vkUp = false;
    hiddenAt = Date.now();
    log("cancel");
  });
  vk.addEventListener("geometrychange", () => {
    const h = vk.boundingRect?.height ?? 0;
    log(`geometry h=${h}`);
    if (h <= 0) {
      if (vkUp) hiddenAt = Date.now();
      vkUp = false;
    }
  });
} else {
  log("navigator.virtualKeyboard MISSING");
}
var moved = 0;
var startY = -1;
var touchWithKb = false;
screen.addEventListener("touchstart", (e) => {
  touchWithKb = vkUp;
  moved = 0;
  startY = e.touches?.[0]?.screenY ?? -1;
});
screen.addEventListener("touchmove", (e) => {
  const y = e.touches?.[0]?.screenY;
  if (typeof y === "number" && startY >= 0) moved = Math.max(moved, Math.abs(y - startY));
});
screen.addEventListener("touchend", () => {
  if (!touchWithKb && moved < 40) open();
});
addEventListener("beforeunload", () => {
  log(`beforeunload (plus) frames=${frames} vkUp=${vkUp}${vkUp ? " \u2014 exit prevented by keyboard guard" : " \u2014 exiting"}`);
});
var last = /* @__PURE__ */ new Set();
function frame() {
  frames++;
  const gp = navigator.getGamepads?.()?.[0];
  if (gp) {
    const now = /* @__PURE__ */ new Set();
    for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed) now.add(i);
    for (const i of now) if (!last.has(i)) {
      if (i === 3) open();
      if (i === 8) {
        log("minus -> clean exit");
        if (vkUp) {
          try {
            vk.hide();
          } catch {
          }
        }
        setTimeout(() => Switch.exit(), 300);
        return;
      }
    }
    last = now;
  }
  render();
  requestAnimationFrame(frame);
}
log(`boot on nx.js ${Switch.version?.nxjs ?? "?"}`);
requestAnimationFrame(frame);
