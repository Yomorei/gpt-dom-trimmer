// ==UserScript==
// @name         ChatGPT DOM Trimmer
// @namespace    yomorei.chatgpt.domtrimmer
// @version      1.3.0
// @description  Keeps ChatGPT convos fast as FUCK by only rendering a sliding window of turns. No request interception so dw ur agent will not be affected in anyway shape or form. :>
// @author       Yomorei
// @license      MIT
// @match        https://chatgpt.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const CFG = {
    minKeep: 5,
    maxKeep: 500,
    minChunk: 5,
    maxChunk: 200,
    step: 5,

    defaultKeep: 10,
    defaultChunk: 10,

    topThresholdPx: 220,
    bottomThresholdPx: 260,

    pruneDelayMs: 90,
    hrefPollMs: 650,

    turnSelectors: [
      'article[data-testid^="conversation-turn-"]',
      'div[data-testid^="conversation-turn-"]',
      'div[data-testid="conversation-turn"]'
    ]
  };

  const KEY = {
    enabled: "yomo_trim_enabled",
    keep: "yomo_trim_keep",
    chunk: "yomo_trim_chunk",
    collapsed: "yomo_trim_collapsed"
  };

  const clampInt = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.floor(n);
    if (i < min) return min;
    if (i > max) return max;
    return i;
  };

  const roundToStep = (n) => Math.round(n / CFG.step) * CFG.step;

  const state = {
    enabled: Boolean(GM_getValue(KEY.enabled, true)),
    keep: clampInt(GM_getValue(KEY.keep, CFG.defaultKeep), CFG.minKeep, CFG.maxKeep, CFG.defaultKeep),
    chunk: clampInt(GM_getValue(KEY.chunk, CFG.defaultChunk), CFG.minChunk, CFG.maxChunk, CFG.defaultChunk),
    collapsed: Boolean(GM_getValue(KEY.collapsed, true)),

    start: 0,
    end: 0,
    followTail: true,

    lastHref: location.href,
    scheduled: false,
    shifting: false
  };

  let ui = null;

  const css = `
#yomoTrimRoot{position:fixed;right:44px;bottom:12px;z-index:999999;font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#eee}
#yomoTrimChip{background:#111;border:1px solid #333;border-radius:8px;padding:7px 9px;cursor:pointer;user-select:none}
#yomoTrimPanel{width:260px;background:#111;border:1px solid #333;border-radius:10px;padding:10px}
#yomoTrimHdr{display:flex;align-items:center;justify-content:space-between}
#yomoTrimTitle{font-weight:600}
#yomoTrimCollapse{border:1px solid #333;background:#1b1b1b;color:#eee;border-radius:6px;width:28px;height:24px;cursor:pointer}
#yomoTrimCollapse:hover{background:#222}
#yomoTrimCollapse:focus{outline:none}
#yomoTrimCollapse:focus-visible{outline:1px solid #555}
#yomoTrimEnabledRow{margin-top:10px;display:flex;align-items:center;gap:8px}
#yomoTrimEnabled{margin:0}
#yomoTrimEnabled:focus{outline:none}
#yomoTrimEnabled:focus-visible{outline:1px solid #555;outline-offset:2px;border-radius:3px}
#yomoTrimGrid{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.yomoLabel{opacity:.9;margin-bottom:6px}
.yomoBox{display:flex;align-items:stretch;border:1px solid #333;border-radius:8px;overflow:hidden;background:#1b1b1b}
.yomoBox.bad{border-color:#ff6b6b}
.yomoVal{flex:1;padding:8px 10px;display:flex;align-items:center;user-select:none}
.yomoBtns{width:30px;border-left:1px solid #333;display:flex;flex-direction:column}
.yomoBtns button{flex:1;border:0;background:transparent;color:#eee;cursor:pointer;line-height:1}
.yomoBtns button:hover{background:#242424}
.yomoBtns button:focus{outline:none}
.yomoBtns button:focus-visible{outline:1px solid #555;outline-offset:-1px}
.yomoHelp{min-height:14px;margin-top:6px;font-size:11px;color:#ff9a9a}
#yomoTrimStatus{margin-top:10px;opacity:.85}
  `.trim();

  const injectStyle = () => {
    if (document.getElementById("yomoTrimStyle")) return;
    const s = document.createElement("style");
    s.id = "yomoTrimStyle";
    s.textContent = css;
    document.documentElement.appendChild(s);
  };

  const scroller = () => document.scrollingElement || document.documentElement;

  const getRoot = () => document.querySelector("main") || document.body || document.documentElement;

  const getTurns = () => {
    const root = getRoot();
    for (const sel of CFG.turnSelectors) {
      const nodes = root.querySelectorAll(sel);
      if (nodes && nodes.length) return Array.from(nodes);
    }
    return [];
  };

  const setCollapsed = (collapsed) => {
    state.collapsed = collapsed;
    GM_setValue(KEY.collapsed, collapsed);
    ui.panel.style.display = collapsed ? "none" : "block";
    ui.chip.style.display = collapsed ? "block" : "none";
    ui.collapse.textContent = collapsed ? "▸" : "▾";
  };

  const setStatus = (text) => {
    if (!ui) return;
    ui.status.textContent = text;
  };

  const flashBad = (field, msg) => {
    field.box.classList.add("bad");
    field.help.textContent = msg;
    window.setTimeout(() => {
      field.box.classList.remove("bad");
      if (field.help.textContent === msg) field.help.textContent = "";
    }, 650);
  };

  const clearBad = (field) => {
    field.box.classList.remove("bad");
    field.help.textContent = "";
  };

  const updateFieldUI = () => {
    ui.keep.val.textContent = String(state.keep);
    ui.chunk.val.textContent = String(state.chunk);
  };

  const bump = (which, dir) => {
    const isKeep = which === "keep";
    const min = isKeep ? CFG.minKeep : CFG.minChunk;
    const max = isKeep ? CFG.maxKeep : CFG.maxChunk;
    const cur = isKeep ? state.keep : state.chunk;
    const next = clampInt(roundToStep(cur + dir * CFG.step), min, max, cur);

    const field = isKeep ? ui.keep : ui.chunk;

    if (next === cur) {
      flashBad(field, cur <= min ? `Minimum is ${min}` : `Maximum is ${max}`);
      return;
    }

    if (isKeep) state.keep = next;
    else state.chunk = next;

    clearBad(field);
    updateFieldUI();

    GM_setValue(isKeep ? KEY.keep : KEY.chunk, next);

    state.start = 0;
    state.end = 0;
    schedule();
  };

  const hideRange = (turns, from, to) => {
    const a = Math.max(0, from);
    const b = Math.min(turns.length, to);
    for (let i = a; i < b; i++) turns[i].hidden = true;
  };

  const showRange = (turns, from, to) => {
    const a = Math.max(0, from);
    const b = Math.min(turns.length, to);
    for (let i = a; i < b; i++) turns[i].hidden = false;
  };

  const applyInitialWindow = (turns, start) => {
    for (let i = 0; i < turns.length; i++) turns[i].hidden = true;
    const end = Math.min(turns.length, start + state.keep);
    showRange(turns, start, end);
    state.start = start;
    state.end = end;
  };

  const applyWindowDelta = (turns, newStart) => {
    const total = turns.length;
    const targetStart = Math.max(0, Math.min(newStart, Math.max(0, total - state.keep)));
    const targetEnd = Math.min(total, targetStart + state.keep);

    const oldStart = state.start;
    const oldEnd = state.end;

    if (oldStart === 0 && oldEnd === 0) {
      applyInitialWindow(turns, targetStart);
      return;
    }

    hideRange(turns, oldStart, Math.min(oldEnd, targetStart));
    hideRange(turns, Math.max(oldStart, targetEnd), oldEnd);

    showRange(turns, targetStart, Math.min(targetEnd, oldStart));
    showRange(turns, Math.max(targetStart, oldEnd), targetEnd);

    state.start = targetStart;
    state.end = targetEnd;
  };

  const computeFollowTail = () => {
    const el = scroller();
    const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
    state.followTail = dist < CFG.bottomThresholdPx;
  };

  const refreshForTurns = (turns) => {
    if (!turns.length) {
      state.start = 0;
      state.end = 0;
      setStatus("Chat trim: No turns found");
      return;
    }

    computeFollowTail();

    const total = turns.length;
    const maxStart = Math.max(0, total - state.keep);

    if (state.start === 0 && state.end === 0) {
      applyInitialWindow(turns, maxStart);
      return;
    }

    if (state.followTail) {
      applyWindowDelta(turns, maxStart);
      return;
    }

    if (state.start > maxStart) applyWindowDelta(turns, maxStart);
    else applyWindowDelta(turns, state.start);
  };

  const shiftUp = () => {
    if (state.shifting || !state.enabled) return;

    const turns = getTurns();
    if (!turns.length) return;
    if (state.start <= 0) return;

    state.shifting = true;

    const oldStart = state.start;
    const oldEnd = state.end;

    const delta = clampInt(state.chunk, CFG.minChunk, CFG.maxChunk, CFG.defaultChunk);
    const newStart = Math.max(0, oldStart - delta);

    const newlyShownFrom = newStart;
    const newlyShownTo = oldStart;

    showRange(turns, newlyShownFrom, newlyShownTo);

    let added = 0;
    for (let i = newlyShownFrom; i < newlyShownTo; i++) {
      const h = turns[i].getBoundingClientRect().height;
      if (Number.isFinite(h)) added += h;
    }

    applyWindowDelta(turns, newStart);

    const el = scroller();
    el.scrollTop = el.scrollTop + added;

    hideRange(turns, state.end, oldEnd);

    state.shifting = false;
  };

  const shiftDown = () => {
    if (state.shifting || !state.enabled) return;

    const turns = getTurns();
    if (!turns.length) return;

    const total = turns.length;
    const maxStart = Math.max(0, total - state.keep);
    if (state.start >= maxStart) return;

    state.shifting = true;

    const oldStart = state.start;
    const oldEnd = state.end;

    const delta = clampInt(state.chunk, CFG.minChunk, CFG.maxChunk, CFG.defaultChunk);
    const newStart = Math.min(maxStart, oldStart + delta);

    const removedFrom = oldStart;
    const removedTo = Math.min(oldEnd, newStart);

    let removed = 0;
    for (let i = removedFrom; i < removedTo; i++) {
      const h = turns[i].getBoundingClientRect().height;
      if (Number.isFinite(h)) removed += h;
    }

    applyWindowDelta(turns, newStart);

    const el = scroller();
    el.scrollTop = Math.max(0, el.scrollTop - removed);

    showRange(turns, oldEnd, state.end);

    state.shifting = false;
  };

  const onScroll = () => {
    if (!state.enabled || state.shifting) return;

    const el = scroller();
    const nearTop = el.scrollTop < CFG.topThresholdPx;
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < CFG.bottomThresholdPx;

    if (nearTop) shiftUp();
    else if (nearBottom) shiftDown();
  };

  const schedule = () => {
    if (state.scheduled) return;
    state.scheduled = true;

    setTimeout(() => {
      state.scheduled = false;

      if (location.href !== state.lastHref) {
        state.lastHref = location.href;
        state.start = 0;
        state.end = 0;
      }

      const turns = getTurns();

      if (!state.enabled) {
        for (const t of turns) t.hidden = false;
        setStatus("Chat trim: Disabled");
        return;
      }

      refreshForTurns(turns);

      if (turns.length) {
        const total = turns.length;
        const shown = state.end - state.start;
        setStatus(`Chat trim: Showing ${shown}/${total}`);
      }
    }, CFG.pruneDelayMs);
  };

  const observeTurns = () => {
    const root = getRoot();
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          const el = n;

          for (const sel of CFG.turnSelectors) {
            if (el.matches?.(sel) || el.querySelector?.(sel)) {
              schedule();
              return;
            }
          }
        }
      }
    });

    mo.observe(root, { childList: true, subtree: true });
  };

  const hrefPoll = () => {
    setInterval(() => {
      if (location.href !== state.lastHref) schedule();
    }, CFG.hrefPollMs);
  };

  const buildUI = () => {
    injectStyle();

    const root = document.createElement("div");
    root.id = "yomoTrimRoot";

    const chip = document.createElement("div");
    chip.id = "yomoTrimChip";
    chip.textContent = "Chat trim";
    chip.title = "Open";

    const panel = document.createElement("div");
    panel.id = "yomoTrimPanel";

    panel.innerHTML = `
      <div id="yomoTrimHdr">
        <div id="yomoTrimTitle">Chat trim</div>
        <button type="button" id="yomoTrimCollapse" title="Collapse">▾</button>
      </div>

      <div id="yomoTrimEnabledRow">
        <input type="checkbox" id="yomoTrimEnabled">
        <label for="yomoTrimEnabled">Enabled</label>
      </div>

      <div id="yomoTrimGrid">
        <div>
          <div class="yomoLabel">Keep</div>
          <div class="yomoBox" id="yomoKeepBox">
            <div class="yomoVal" id="yomoKeepVal"></div>
            <div class="yomoBtns">
              <button type="button" id="yomoKeepUp" aria-label="Increase keep">▲</button>
              <button type="button" id="yomoKeepDown" aria-label="Decrease keep">▼</button>
            </div>
          </div>
          <div class="yomoHelp" id="yomoKeepHelp"></div>
        </div>

        <div>
          <div class="yomoLabel">Chunk</div>
          <div class="yomoBox" id="yomoChunkBox">
            <div class="yomoVal" id="yomoChunkVal"></div>
            <div class="yomoBtns">
              <button type="button" id="yomoChunkUp" aria-label="Increase chunk">▲</button>
              <button type="button" id="yomoChunkDown" aria-label="Decrease chunk">▼</button>
            </div>
          </div>
          <div class="yomoHelp" id="yomoChunkHelp"></div>
        </div>
      </div>

      <div id="yomoTrimStatus">Chat trim: initializing…</div>
    `.trim();

    root.appendChild(chip);
    root.appendChild(panel);
    document.documentElement.appendChild(root);

    ui = {
      chip,
      panel,
      collapse: panel.querySelector("#yomoTrimCollapse"),
      enabled: panel.querySelector("#yomoTrimEnabled"),
      keep: {
        box: panel.querySelector("#yomoKeepBox"),
        val: panel.querySelector("#yomoKeepVal"),
        help: panel.querySelector("#yomoKeepHelp"),
        up: panel.querySelector("#yomoKeepUp"),
        down: panel.querySelector("#yomoKeepDown")
      },
      chunk: {
        box: panel.querySelector("#yomoChunkBox"),
        val: panel.querySelector("#yomoChunkVal"),
        help: panel.querySelector("#yomoChunkHelp"),
        up: panel.querySelector("#yomoChunkUp"),
        down: panel.querySelector("#yomoChunkDown")
      },
      status: panel.querySelector("#yomoTrimStatus")
    };

    ui.enabled.checked = state.enabled;
    updateFieldUI();

    ui.enabled.addEventListener("change", () => {
      state.enabled = Boolean(ui.enabled.checked);
      GM_setValue(KEY.enabled, state.enabled);

      const turns = getTurns();
      if (!state.enabled) {
        for (const t of turns) t.hidden = false;
        setStatus("Chat trim: Disabled");
        return;
      }

      state.start = 0;
      state.end = 0;
      schedule();
    });

    ui.keep.up.addEventListener("click", () => bump("keep", +1));
    ui.keep.down.addEventListener("click", () => bump("keep", -1));
    ui.chunk.up.addEventListener("click", () => bump("chunk", +1));
    ui.chunk.down.addEventListener("click", () => bump("chunk", -1));

    ui.collapse.addEventListener("click", () => setCollapsed(true));
    chip.addEventListener("click", () => setCollapsed(false));

    setCollapsed(state.collapsed);
  };

  const init = () => {
    buildUI();
    observeTurns();
    hrefPoll();

    document.addEventListener(
      "scroll",
      () => {
        onScroll();
      },
      { passive: true }
    );

    schedule();
  };

  init();
})();