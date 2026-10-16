/* ============================================================
 * 「いろ」 game.js ―― エンジン本体（ステージ1:骨格）
 * 構成: U / Input / AudioSys / Assets / Save / FX / Dialogue
 *        TitleScene / HowtoScene / ExploreScene / Game(ループ)
 * 以後のステージ(戦闘・章進行・演出)は、この scene / state に
 * 接続する形でのみ拡張する。既存の公開名は壊さない。
 * ============================================================ */
(function () {
  "use strict";

  /* ================= U: 共通ユーティリティ ================= */
  const W = 320, H = 240, TILE = 16;
  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    wrapJP(text, maxChars) { // 日本語本文を行数で折り返す
      const out = [];
      for (const raw of String(text).split("\n")) {
        if (raw === "") { out.push(""); continue; }
        for (let i = 0; i < raw.length; i += maxChars) out.push(raw.substr(i, maxChars));
      }
      return out;
    },
  };
  const FONT_FAMILY =
    '"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif'; // ※後で @font-face の差し替え余地あり
  const FONT = (px, wgt) => `${wgt || 400} ${px}px ${FONT_FAMILY}`;

  /* パレット:現実はモノクロ、向こう側は歪で鮮やかな色。
     素材がカラーでも、現実は合成時にグレースケールをかける(§3)。*/
  const PAL = {
    real: {
      floor: "#e9e9e9", floorDot: "#d6d6d6", wall: "#9a9a9a", wallTop: "#7c7c7c",
      door: "#f5f5f5", doorFrame: "#5c5c5c", grass: "#c2c7c2", path: "#d4d4d4",
      win: "#f8f8f8", furniture: "#cfcfcf", furnEdge: "#8a8a8a", shadow: "rgba(0,0,0,.25)",
      ui: "#101010", uiEdge: "#e6e6e6", text: "#111", accent: "#444",
    },
    other: {
      floor: "#3b1150", floorDot: "#29e05f", wall: "#6b0f2e", wallTop: "#38081c",
      door: "#ffd23f", doorFrame: "#0ff0e6", grass: "#1fd463", path: "#ffb03a",
      win: "#ff2d95", furniture: "#7b2fbe", furnEdge: "#ff2d95", shadow: "rgba(10,0,20,.45)",
      ui: "#1a0026", uiEdge: "#ff2d95", text: "#f4e8ff", accent: "#29e05f",
    },
  };

  /* ================= Input: キーボード + 画面ボタン ================= */
  const KEYMAP = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    KeyZ: "z", Enter: "z", KeyX: "x", Escape: "x", KeyC: "c",
  };
  const Input = {
    down: {}, pressed: {},
    virtual(name, isDown) { // 画面ボタンから呼ぶ
      if (isDown) { if (!this.down[name]) this.pressed[name] = true; this.down[name] = true; }
      else this.down[name] = false;
    },
    endFrame() { this.pressed = {}; },
    bind() {
      window.addEventListener("keydown", (e) => {
        const n = KEYMAP[e.code];
        if (n) { e.preventDefault(); if (!this.down[n]) this.pressed[n] = true; this.down[n] = true; }
        if (e.code === "Space") e.preventDefault();
      });
      window.addEventListener("keyup", (e) => {
        const n = KEYMAP[e.code]; if (n) this.down[n] = false;
      });
      window.addEventListener("blur", () => { this.down = {}; });
    },
  };
  Input.bind();

  /* ================= AudioSys: WebAudio ビープ/BGM ================= */
  const AudioSys = {
    ctx: null, master: null, ready: false, tickTimer: null, world: "real",
    ensure() {
      if (this.ready) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.22;
        this.master.connect(this.ctx.destination);
        this.ready = true; this.applyAmbience();
      } catch (e) { /* 音は無くてもゲームは止めない */ }
    },
    beep(freq, dur, type, vol, slide) {
      if (!this.ready) return;
      try {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type || "square"; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
        g.gain.setValueAtTime(vol == null ? 0.5 : vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
      } catch (e) {}
    },
    sfx(name) {
      switch (name) {
        case "select": this.beep(740, 0.07, "square", 0.4); break;
        case "cancel": this.beep(240, 0.1, "square", 0.35); break;
        case "tick": this.beep(1250, 0.016, "square", 0.10); break;
        case "door": this.beep(180, 0.14, "sine", 0.5, 90); break;
        case "call": this.beep(880, 0.09, "triangle", 0.5); setTimeout(() => this.beep(1175, 0.12, "triangle", 0.5), 110); break;
        case "bloom": this.beep(300, 0.5, "sawtooth", 0.25, 1500); break;
        case "bad": this.beep(120, 0.7, "sawtooth", 0.4, 60); break;
        case "heal": this.beep(520, 0.09, "sine", 0.4); setTimeout(() => this.beep(660, 0.12, "sine", 0.4), 90); break;
      }
    },
    /* 現実のBGMは無音近く、時計と足音。向こう側は不協和音のドローン。*/
    applyAmbience() {
      if (!this.ready) return;
      clearInterval(this.tickTimer);
      if (this.world === "real") {
        let acc = 0;
        this.tickTimer = setInterval(() => { // 時計の針(1Hz)
          acc++; this.beep(2000, 0.015, "sine", acc % 4 === 0 ? 0.06 : 0.03);
        }, 1000);
      } else {
        const mk = (f, v) => {
          const o = this.ctx.createOscillator(), g = this.ctx.createGain();
          o.type = "sawtooth"; o.frequency.value = f; g.gain.value = v;
          o.connect(g); g.connect(this.master); o.start(); return o;
        };
        try { this.droneA = this.droneA || mk(98, 0.028); this.droneB = this.droneB || mk(103.8, 0.022); } catch (e) {}
      }
      if (this.world === "real") { try { if (this.droneA) { this.droneA.stop(); this.droneB.stop(); this.droneA = this.droneB = null; } } catch (e) {} }
    },
    setWorld(w) { if (this.world !== w) { this.world = w; if (this.ready) this.applyAmbience(); } },
  };

  /* ================= Assets: プリロード(失敗は仮矩形で代替) ================= */
  const ASSET_KEYS = {
    characters: ["mio_real", "mio_other", "kaede", "kaede_gauze", "mother", "doctor", "nurse_night", "staff_meal", "hana"],
    monsters: ["mike", "gyorome", "honey_queen", "gatekeeper_l", "gatekeeper_s",
               "witch_0", "witch_1", "witch_2", "witch_3", "witch_4"],
    tiles: ["tileset_real", "tileset_other"],
    bg: ["real_room", "real_hall", "real_lounge", "real_courtyard", "real_station", "real_canteen", "real_visiting", "real_roof",
         "other_room", "other_hall", "other_lounge", "other_courtyard", "other_station", "other_canteen", "other_visiting", "other_roof",
         "title", "battle_bg_123", "battle_bg_4_0", "battle_bg_4_1", "battle_bg_4_2", "battle_bg_4_3", "battle_bg_4_4",
         "transition_white", "ending_grave", "ending_entrance", "bad1_room", "bad7_box"],
  };
  const Assets = {
    items: {}, loading: false, done: 0, total: 0,
    preload() {
      const list = [];
      for (const dir of Object.keys(ASSET_KEYS)) for (const name of ASSET_KEYS[dir]) list.push({ key: `${dir}/${name}`, src: `assets/${dir}/${name}.png` });
      this.total = list.length; this.loading = true;
      return new Promise((resolve) => {
        let finished = 0;
        for (const it of list) {
          const img = new Image();
          this.items[it.key] = { img, ok: false, src: it.src };
          img.onload = () => { this.items[it.key].ok = true; this.done = ++finished; if (finished === this.total) { this.loading = false; resolve(); } };
          img.onerror = () => { this.done = ++finished; if (finished === this.total) { this.loading = false; resolve(); } };
          img.src = it.src;
        }
      });
    },
    get(key) { return this.items[key] || null; },
    /** アセットを描画。無ければ「仮の矩形 + ファイル名ラベル」。
     *  w,h を指定すると aspect fit で中央配置(anchor: bottom で足元固定)。 */
    draw(ctx, key, x, y, w, h, opts) {
      opts = opts || {};
      const it = this.get(key);
      const world = opts.world || "real";
      const pal = PAL[world];
      if (it && it.ok && it.img && it.img.width > 0) {
        const iw = it.img.width, ih = it.img.height;
        let dw = w, dh = h;
        if (!opts.stretch) { const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s; }
        const dx = x + (w - dw) / 2, dy = opts.anchor === "bottom" ? y + h - dh : y + (h - dh) / 2;
        if (opts.frame != null && iw % 3 === 0) { // 3x4スプライトシート運用時
          const fw = iw / 3, fh = ih / 4;
          ctx.drawImage(it.img, (opts.frame % 3) * fw, Math.floor(opts.frame / 3) * fh, fw, fh, dx, dy, dw, dh);
        } else ctx.drawImage(it.img, dx, dy, dw, dh);
        return { real: true };
      }
      // ―― 仮矩形 ――
      ctx.fillStyle = world === "real" ? "#b9b9b9" : ["#ff2d95", "#8a2be2", "#29e05f", "#ffd23f"][(key.length + (opts.seed || 0)) % 4];
      ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = world === "real" ? "#6f6f6f" : "#0ff0e6";
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (opts.label !== false && w >= 34) {
        const label = (opts.label || key.split("/")[1] || key);
        ctx.fillStyle = world === "real" ? "#333" : "#fff";
        ctx.font = FONT(7);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, x + w / 2, y + h / 2, w - 4);
      }
      return { real: false };
    },
  };

  /* ================= Save: localStorage(try/catch)+メモリフォールバック ================= */
  const Save = (function () {
    const KEY = "iro_save_v1";
    let mem = null; let storage = null;
    try { localStorage.setItem(KEY + "_t", "1"); localStorage.removeItem(KEY + "_t"); storage = localStorage; }
    catch (e) { storage = { getItem: () => mem && mem[KEY], setItem: (k, v) => { mem = mem || {}; mem[k] = v; }, removeItem: (k) => { if (mem) delete mem[k]; } }; }
    return {
      has() { try { return !!storage.getItem(KEY); } catch (e) { return false; } },
      write(state) { try { storage.setItem(KEY, JSON.stringify({ v: 1, t: Date.now(), state })); return true; } catch (e) { return false; } },
      read() { try { const s = storage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
      clear() { try { storage.removeItem(KEY); } catch (e) {} },
    };
  })();

  /* ================= 全体状態(章進行・熟れ度・フラグ) ================= */
  function defaultState() {
    return {
      chapter: "prologue", day: 3, time: "朝", world: "real",
      map: "room", x: 10, y: 12,
      objective: "", ripeness: 0, ripeCount: 0, ripeCd: 0, npcTalk: {},
      flags: {},
    };
  }
  const state = defaultState();
  const Game = {
    canvas: null, ctx: null, buf: null, bctx: null, scale: 1,
    scene: null, sceneName: "", fx: null, bloom: null, toasts: [],
    sceneFactories: {},
    state, STORY: window.IRO_STORY, MAPS: window.IRO_MAPS,
    registerScene(name, factory) { this.sceneFactories[name] = factory; },
    resetState() { // 章進行をリセット(タイトルでの「はじめる」用)。フラグは引き継ぐ
      const keepFlags = state.flags;
      Object.assign(state, defaultState(), { flags: keepFlags });
    },
    toast(text) { this.toasts.push({ text, t: 2.6 }); },
    setScene(name, data) {
      Input.pressed = {}; // 遷移直前のZ/X入力を次のシーンにリークさせない
      this.sceneName = name;
      if (name === "title") this.scene = makeTitle();
      else if (name === "howto") this.scene = makeHowto(data);
      else if (name === "explore") this.scene = makeExplore(data);
      else if (this.sceneFactories[name]) this.scene = this.sceneFactories[name](data);
      else { console.warn("no such scene:", name); this.scene = makeTitle(); }
      if (this.scene.init) this.scene.init(data);
    },
    // ―― 戦闘/バッドエンドの入口(battle.js が scene を登録して受ける)――
    startBattle(id) {
      Game.transition(() => {
        state.world = "other"; AudioSys.setWorld("other");
        Game.setScene("battle", { id });
      }, "bloom");
    },
    endBattle() {
      Game.transition(() => {
        state.world = "real"; AudioSys.setWorld("real");
        Game.setScene("explore", { intro: false });
      }, "bloom");
    },
    badEnd(key) {
      state.flags["bad_" + key] = true;
      if (key === "bad7") state.flags.bad7seen = true;
      Game.transition(() => {
        state.world = "real"; AudioSys.setWorld("real");
        Game.setScene("badend", { key });
      }, "fade");
    },
    /* ---- 空の熟れ度(§4:0〜100。100で強制転送/70以上でナースコール解除) ---- */
    addRipeness(v) { state.ripeness = U.clamp(state.ripeness + v, 0, 100); },
    /** 現実⇄向こう側の強制移動 */
    shiftToWorld(w, msg) {
      if (state.world === w) return false;
      Game.transition(() => {
        state.world = w; AudioSys.setWorld(w);
        state.time = w === "other" ? "夜" : "朝";
        if (w === "other") { state.ripeness = Math.min(state.ripeness, 88); state.ripeCd = 10; }
        if (msg) Game.toast(msg);
      }, "bloom");
      return true;
    },
    /** 暗転 → mid() で切替 → 明ける。明けども(中間点すぎ)なら新しい転送で上書き可 */
    transition(mid, type) {
      if (this.fx && this.fx.t < this.fx.dur / 2) return;
      this.fx = { type: type || "fade", t: 0, dur: 0.7, mid, midDone: false };
    },
    updateFX(dt) {
      if (!this.fx) return;
      const fx = this.fx; fx.t += dt;
      const half = fx.dur / 2;
      if (!fx.midDone && fx.t >= half) { fx.midDone = true; try { fx.mid && fx.mid(); } catch (e) { console.error(e); } }
      if (fx.t >= fx.dur) { this.fx = null; this.bloom = null; }
      // 色のにじみ(簡易):向こう側へ入るとき、中心から色を広げる
      if (fx.type === "bloom") this.bloom = { p: U.clamp((fx.t - half) / half, 0, 1) };
    },
    saveNow() {
      state.map = this.scene && this.scene.mapId ? this.scene.mapId : state.map;
      const ok = Save.write(state);
      this.toast(ok ? "保存しました" : "保存できませんでした");
    },
  };
  // (モジュール公開はファイル末尾で行う ―― const の TDZ 回避)

  /* ================= Dialogue: 会話ウィンドウ ================= */
  const Dialogue = {
    active: false, pages: [], page: 0, shown: 0, speed: 26, timer: 0, onDone: null, who: "",
    open(lines, onDone) { // lines: [{n,t}] または [string]
      this.pages = lines.map((l) => (typeof l === "string" ? { n: "", t: l } : l));
      // 折り返しでページ分割
      const out = [];
      for (const p of this.pages) {
        const rows = U.wrapJP(p.t, 20);
        if (rows.length <= 3) out.push({ n: p.n, rows });
        else for (let i = 0; i < rows.length; i += 3) out.push({ n: p.n, rows: rows.slice(i, i + 3) });
      }
      this.pages = out; this.page = 0; this.shown = 0; this.timer = 0; this.active = true; this.onDone = onDone || null;
    },
    cur() { return this.pages[this.page]; },
    totalChars(p) { return p.rows.join("").length; },
    update(dt) {
      if (!this.active) return;
      const p = this.cur(); const total = this.totalChars(p);
      if (this.shown < total) {
        this.timer += dt * 1000;
        while (this.timer >= this.speed && this.shown < total) { this.timer -= this.speed; this.shown++; }
        if (this.shown % 2 === 0) AudioSys.sfx("tick");
      }
      if (Input.pressed.z) {
        if (this.shown < total) this.shown = total;
        else { this.page++; this.shown = 0; this.timer = 0; if (this.page >= this.pages.length) this.close(); }
      } else if (Input.pressed.x && this.shown >= total) { this.close(); }
    },
    close() { this.active = false; const cb = this.onDone; this.onDone = null; if (cb) cb(); },
    draw(ctx) {
      if (!this.active) return;
      const p = this.cur(); const dark = state.world !== "real";
      const wx = 8, wy = H - 74, ww = W - 16, wh = 66;
      // 現実は「白地の台詞枠・黒文字」、向こう側は「暗紫・明文字」
      const bg   = dark ? "#1a0026" : "#f4f4f4";
      const edge = dark ? "#ff2d95" : "#111111";
      const txt  = dark ? "#f4e8ff" : "#111111";
      // 背景を潰さない:全面の黒スクリーンは使わず、下部だけの緩やかなグラデーション暗転
      let useGrad = false;
      if (ctx.createLinearGradient) {
        try {
          const g = ctx.createLinearGradient(0, H * 0.42, 0, H);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, dark ? "rgba(12,0,20,.28)" : "rgba(0,0,0,.20)");
          ctx.fillStyle = g;
          useGrad = true;
        } catch (e) { /* 非対応環境は平坦な薄暗転にフォールバック */ }
      }
      if (!useGrad) ctx.fillStyle = "rgba(0,0,0,.16)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = bg; ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = edge; ctx.lineWidth = 1;
      ctx.strokeRect(wx + 1.5, wy + 1.5, ww - 3, wh - 3);
      ctx.strokeRect(wx + 3.5, wy + 3.5, ww - 7, wh - 7);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      if (p.n) {
        ctx.font = FONT(10, 700);
        const nw = ctx.measureText(p.n).width + 10;
        ctx.fillStyle = "#111111";
        ctx.fillRect(wx + 8, wy - 8, nw, 14);
        ctx.fillStyle = "#f6f6f6";
        ctx.fillText(p.n, wx + 13, wy - 5);
      }
      ctx.font = FONT(12); ctx.fillStyle = txt;
      let remain = this.shown;
      for (let i = 0; i < p.rows.length; i++) {
        const line = p.rows[i];
        const show = remain >= line.length ? line : line.substr(0, Math.max(0, remain));
        ctx.fillText(show, wx + 10, wy + 10 + i * 17);
        remain -= line.length;
      }
      if (this.shown >= this.totalChars(p)) {
        if (Math.floor(performance.now() / 400) % 2 === 0) {
          ctx.fillStyle = edge; ctx.beginPath();
          ctx.moveTo(ww - 12, wy + wh - 12); ctx.lineTo(ww - 4, wy + wh - 12); ctx.lineTo(ww - 8, wy + wh - 6); ctx.fill();
        }
      }
    },
  };

  /* ================= TitleScene ================= */
  function makeTitle() {
    const entries = [{ label: "はじめる", act: "start" }];
    if (Save.has()) entries.push({ label: "つづきから", act: "continue" });
    entries.push({ label: "あそびかた", act: "howto" });
    if (state.flags.bad7seen) entries.push({ label: "ナースコールを、押す", act: "nursecall" });
    let sel = 0;
    return {
      update(dt) {
        if (Input.pressed.up) { sel = (sel + entries.length - 1) % entries.length; AudioSys.sfx("select"); }
        if (Input.pressed.down) { sel = (sel + 1) % entries.length; AudioSys.sfx("select"); }
        if (Input.pressed.z) {
          AudioSys.ensure();
          const act = entries[sel].act;
          Game.transition(() => {
            if (act === "start") {
              Game.resetState();
              Game.setScene("explore", { intro: true });
            } else if (act === "continue") {
              const s = Save.read();
              if (s && s.state) Object.assign(state, s.state);
              Game.setScene("explore", { intro: false });
            } else if (act === "howto") {
              Game.setScene("howto");
            } else if (act === "nursecall") {
              Game.toast("この項目は、最終章を越えたあとに開く");
              Game.setScene("title");
            } else Game.setScene("title");
          }, "fade");
        }
      },
      draw(ctx) {
        const t = performance.now() / 1000;
        Assets.draw(ctx, "bg/title", 0, 0, W, H, { world: "real", stretch: true, label: false });
        ctx.fillStyle = "rgba(10,10,12,.55)"; ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center";
        ctx.fillStyle = "#f2f2f2"; ctx.font = `700 58px ${FONT_FAMILY}`;
        ctx.fillText("いろ", W / 2, 44 + Math.sin(t) * 1.5);
        ctx.font = FONT(9); ctx.fillStyle = "#9a9a9a";
        ctx.fillText(Game.STORY.meta.subtitle, W / 2, 108);
        // 注意書き
        ctx.font = FONT(9); ctx.fillStyle = "#d0d0d0";
        ctx.fillText(Game.STORY.meta.warning, W / 2, 132);
        ctx.font = FONT(13, 600);
        entries.forEach((it, i) => {
          const y = 160 + i * 18;
          ctx.fillStyle = i === sel ? "#fff" : "#8f8f8f";
          if (i === sel) { ctx.fillStyle = "#333"; ctx.fillRect(W / 2 - 70, y - 3, 140, 16); ctx.fillStyle = "#fff"; }
          ctx.fillText((i === sel ? "▶ " : "  ") + it.label + (i === sel ? " ◀" : ""), W / 2, y);
        });
        ctx.fillStyle = "#777"; ctx.font = FONT(8);
        ctx.fillText("Z/Enter:决定   ↑↓:えらぶ", W / 2, 232);
      },
    };
  }

  /* ================= HowtoScene ================= */
  function makeHowto() {
    return {
      update() { if (Input.pressed.z || Input.pressed.x) Game.transition(() => Game.setScene("title"), "fade"); },
      draw(ctx) {
        ctx.fillStyle = "#101012"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#eee"; ctx.font = FONT(13, 700); ctx.textAlign = "center";
        ctx.fillText("あそびかた", W / 2, 20);
        ctx.font = FONT(10); ctx.textAlign = "left";
        const lines = Game.STORY.meta.controls.split("\n").concat([
          "",
          "・Cキーで「ナースコール」。合言葉は「空が熟れてきました」。",
          "・画面右下の「空の熟れ度」が 100 になると、向こう側に引っ張られる。",
          "・選択肢の選び方で、物語は分岐する。",
        ]);
        lines.forEach((l, i) => ctx.fillText(l, 24, 42 + i * 16));
        ctx.textAlign = "center"; ctx.fillStyle = "#888"; ctx.font = FONT(9);
        ctx.fillText("Z/X:もどる", W / 2, 226);
      },
    };
  }

  /* ================= ExploreScene: 探索パート ================= */
  function makeExplore(data) {
    const maps = Game.MAPS;
    const S = {
      mapId: state.map && maps[state.map] ? state.map : "room",
      px: 0, py: 0, dir: "down", moving: false, mvt: 0, fromX: 0, fromY: 0, toX: 0, toY: 0,
      labelT: 0, animT: 0, pendingWarp: null,
    };
    const SPEED = 105; // px/秒
    function map() { return maps[S.mapId]; }
    function solid(tx, ty) {
      const m = map();
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
      const ch = m.rows[ty][tx];
      if (ch === "#" || ch === "F" || ch === "w") return true;
      for (const n of (m.npcs || [])) if (n.x === tx && n.y === ty) return true;
      for (const o of (m.objects || [])) if (o.solid !== false && tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h) return true;
      return false;
    }
    function doorAt(tx, ty) { return (map().doors || []).find((d) => d.x === tx && d.y === ty); }

    function placeAtSpawn() {
      const m = map();
      const sp = m.spawn;
      S.px = sp.x * TILE + TILE / 2; S.py = sp.y * TILE + TILE / 2;
      S.fromX = S.toX = sp.x; S.fromY = S.toY = sp.y; S.moving = false;
    }
    function warpTo(toMap, tx, ty) {
      Game.transition(() => {
        S.mapId = toMap; state.map = toMap; state.x = tx; state.y = ty;
        const m = map();
        S.px = tx * TILE + TILE / 2; S.py = ty * TILE + TILE / 2;
        S.fromX = S.toX = tx; S.fromY = S.toY = ty; S.moving = false; S.dir = "down";
        S.labelT = 2.2; AudioSys.sfx("door");
      }, state.world === "real" ? "fade" : "bloom");
    }

    const SC = {
      init(d) {
        if (d && d.intro !== false) {
          // はじめてのとき:プロローグを上映してから病室に出現
          state.chapter = "prologue"; state.day = 3; state.time = "朝"; state.world = "real";
          state.objective = Game.STORY.objectives.prologue;
          S.mapId = state.map = "room";
          placeAtSpawn();
          state.x = 10; state.y = 12;
          S.labelT = 2.2;
          Dialogue.open(Game.STORY.prologue, () => { Game.toast("Zで調べる。Cでナースコール。"); });
        } else {
          S.mapId = state.map && maps[state.map] ? state.map : "room";
          S.px = state.x * TILE + TILE / 2; S.py = state.y * TILE + TILE / 2;
          S.fromX = S.toX = state.x; S.fromY = S.toY = state.y;
          S.labelT = 1.6;
        }
      },
      update(dt) {
        S.animT += dt;
        if (S.labelT > 0) S.labelT -= dt;
        SC.labelT = S.labelT;
        if (Game.fx) return;                       // 転送中は入力を受け付けない
        if (Dialogue.active) { Dialogue.update(dt); return; }
        if (Input.pressed.c) nurseCall();
        if (Input.pressed.z) interact();
        // 移動
        if (!S.moving) {
          let dx = 0, dy = 0;
          if (Input.down.up) { dy = -1; S.dir = "up"; }
          else if (Input.down.down) { dy = 1; S.dir = "down"; }
          else if (Input.down.left) { dx = -1; S.dir = "left"; }
          else if (Input.down.right) { dx = 1; S.dir = "right"; }
          if (dx || dy) {
            const nx = S.toX + dx, ny = S.toY + dy;
            if (!solid(nx, ny)) {
              S.fromX = S.toX; S.fromY = S.toY; S.toX = nx; S.toY = ny;
              S.moving = true; S.mvt = 0;
              const dr = doorAt(nx, ny);
              if (dr) S.pendingWarp = dr;
            }
          }
        }
        if (S.moving) {
          S.mvt += (SPEED * dt) / TILE;
          if (S.mvt >= 1) {
            S.mvt = 1; S.moving = false;
            S.px = S.toX * TILE + TILE / 2; S.py = S.toY * TILE + TILE / 2;
            if (S.pendingWarp) { const w = S.pendingWarp; S.pendingWarp = null; warpTo(w.to, w.tx, w.ty); }
            else { state.x = S.toX; state.y = S.toY; }
          } else {
            S.px = U.lerp(S.fromX, S.toX, S.mvt) * TILE + TILE / 2;
            S.py = U.lerp(S.fromY, S.toY, S.mvt) * TILE + TILE / 2;
          }
        }
        // ※ Game.updateFX は frame ループ側で一度だけ呼ばれる(ここでは進めない)
        // ―― 空の熟れ度:経過で小幅に上昇(夜が大/昼小/向こう側も微増)。100で強制転送 ――
        if (!Dialogue.active && !Game.fx) {
          let rate = 0;
          if (state.world === "real") rate = state.time === "夜" ? 0.35 : state.time === "昼" ? 0.12 : 0.04;
          else rate = 0.1;
          if (state.ripeCd > 0) state.ripeCd -= dt;
          else state.ripeness = U.clamp(state.ripeness + rate * dt, 0, 100);
          if (state.world === "real" && state.ripeness >= 100) {
            Game.shiftToWorld("other", "空が、熟れた。――向こう側に、引きずられる――");
          }
        }
        for (let i = Game.toasts.length - 1; i >= 0; i--) { Game.toasts[i].t -= dt; if (Game.toasts[i].t <= 0) Game.toasts.splice(i, 1); }
      },
      draw(ctx) {
        const m = map(); const world = state.world; const pal = PAL[world];
        const camX = U.clamp(Math.round(S.px - W / 2), 0, Math.max(0, m.w * TILE - W));
        const camY = U.clamp(Math.round(S.py - H / 2), 0, Math.max(0, m.h * TILE - H));
        ctx.save(); ctx.translate(-camX, -camY);
        // タイル
        const x0 = Math.floor(camX / TILE), x1 = Math.min(m.w - 1, Math.ceil((camX + W) / TILE));
        const y0 = Math.floor(camY / TILE), y1 = Math.min(m.h - 1, Math.ceil((camY + H) / TILE));
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawTile(ctx, m, tx, ty, world);
        // 家具(オブジェクト)
        for (const o of (m.objects || [])) drawObject(ctx, o, world);
        // NPC
        for (const n of (m.npcs || [])) drawPerson(ctx, n.sprite, n.x * TILE + 8, n.y * TILE + TILE, 26, n.name, world, false);
        // 主人公
        const key = world === "real" ? "mio_real" : "mio_other";
        const bob = S.moving ? Math.round(Math.sin(S.animT * 12) * 1.2) : 0;
        ctx.fillStyle = pal.shadow;
        ctx.beginPath(); ctx.ellipse(S.px, S.py + 1, 5, 2, 0, 0, 7); ctx.fill();
        drawPerson(ctx, key, S.px, S.py + 2 + bob, 26, "", world, S.dir === "left");
        ctx.restore();
        // ―― 向こう側の装飾:ミケの付き添い + 紫のヴィネット ――
        if (state.world === "other") {
          Assets.draw(ctx, "monsters/mike", Math.round(S.px) + 8, Math.round(S.py) - 12, 16, 16, { world: "other", label: false });
          const rg = ctx.createRadialGradient ? ctx.createRadialGradient(W / 2, H / 2, 92, W / 2, H / 2, 200) : null;
          if (rg) { rg.addColorStop(0, "rgba(60,0,80,0)"); rg.addColorStop(1, "rgba(60,0,80,.42)"); ctx.fillStyle = rg; }
          else ctx.fillStyle = "rgba(60,0,80,.22)";
          ctx.fillRect(0, 0, W, H);
        }
        // ―― HUD ――(会話UIとトーストは frame() の最上位レイヤーで描画)
        drawHUD(ctx, m, world);
      },
    };

    function addRipeness(v) { Game.addRipeness(v); }
    SC.addRipeness = addRipeness;
    SC.dialogueActive = () => Dialogue.active;

    function nurseCall() {
      AudioSys.sfx("call");
      if (state.world === "other") {
        // 向こう側で合言葉を言う → 足音が来て、現実へ戻してもらえる
        state.ripeness = U.clamp(state.ripeness - 55, 0, 100);
        state.ripeCount++;
        Dialogue.open([
          { n: "澪", t: "「……空が、熟れてきました」" },
          { n: "", t: "足音が廊下を走ってくる。ドアが開き、白い制服が入ってくる。" },
          { n: "楓", t: "「来たよ。教えてくれて、それだけでいい」" },
        ], () => Game.shiftToWorld("real", "現実にもどった。廊下は、白い。"));
      } else if (state.ripeness >= 70) {
        // 70以上でコール → 下がる。使うたびに手掛かりが増える(clues はステージ4で消費)
        state.ripeness = U.clamp(state.ripeness - 40, 0, 100);
        state.ripeCount++;
        const clue = Game.STORY.clues[state.ripeCount - 1];
        const pages = [
          { n: "澪", t: "「……空が、熟れてきました」" },
          { n: "楓", t: "「聞いた。ここにいるよ、大丈夫」" },
        ];
        if (clue) pages.push(clue);
        Dialogue.open(pages);
        AudioSys.sfx("heal");
      } else {
        Game.toast("今はまだ、空は熟れていない。……押しても、いい。");
        Dialogue.open([{ n: "楓", t: "「うん、聞いたよ。用事がなくても、押していいの。約束だからね」" }]);
      }
    }

    function interact() {
      const m = map();
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[S.dir];
      const tx = S.toX + d[0], ty = S.toY + d[1];
      // NPC 会話
      for (const n of (m.npcs || [])) if (n.x === tx && n.y === ty) {
        const lines = (Game.STORY.npcLines[n.name] || ["「……」"]).slice();
        const i = (state.npcTalk[n.name] = ((state.npcTalk[n.name] || 0) + 1) % lines.length);
        Dialogue.open([{ n: n.name, t: lines[i] }]);
        AudioSys.sfx("select");
        return;
      }
      // オブジェクト調査
      for (const o of (m.objects || [])) {
        if (tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h) {
          const look = (o.look && Game.STORY.objectLines[o.look]) || defaultLook(o);
          AudioSys.sfx("select");
          if (o.keyItem === "letters") {
            state.objective = Game.STORY.objectives.ch6;
            Dialogue.open([{ n: "", t: look }, { n: "", t: "―― 七通の封筒を読むのは、第六章。いまは、まだ一通目。" }]);
          } else Dialogue.open([{ n: "", t: look }]);
          return;
        }
      }
      // 床を調べる(何もない)
      const ch = (m.rows[ty] && m.rows[ty][tx]) || "#";
      if (ch === "G") Dialogue.open([{ n: "", t: "芝生の匂いがした。……気がするだけだ。ここは現実だ。" }]);
      else if (ch === "." || ch === "P") Dialogue.open([{ n: "", t: "白と黒と灰色。床は、何も教えてくれない。" }]);
    }
    function defaultLook(o) {
      return o.name + "。" + (state.world === "real" ? "ここにあるのは、本物のはずだ。" : "熟れた世界では、別の名前で呼ばれる。");
    }
    return SC;
  }

  /* ---------- タイル/人物の描画 ---------- */
  function drawTile(ctx, m, tx, ty, world) {
    const ch = m.rows[ty] && m.rows[ty][tx] ? m.rows[ty][tx] : "#";
    const x = tx * TILE, y = ty * TILE;
    const pal = PAL[world];
    const seed = (tx * 7 + ty * 13) % 5;
    switch (ch) {
      case "#": {
        ctx.fillStyle = pal.wall; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = pal.wallTop; ctx.fillRect(x, y, TILE, 4);
        if (seed === 0) { ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(x + 2, y + 8, 4, 2); }
        break;
      }
      case "w": { // 壁の窓
        ctx.fillStyle = pal.wall; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = pal.win; ctx.fillRect(x + 2, y + 4, TILE - 4, TILE - 8);
        ctx.strokeStyle = pal.doorFrame; ctx.strokeRect(x + 2.5, y + 4.5, TILE - 5, TILE - 9);
        break;
      }
      case "F": { // 家具タイル(オブジェクト側が描画を引き継ぐ)
        ctx.fillStyle = pal.floor; ctx.fillRect(x, y, TILE, TILE);
        break;
      }
      case "D": { // 出入口
        ctx.fillStyle = pal.floor; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = pal.door; ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        ctx.strokeStyle = pal.doorFrame; ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
        break;
      }
      case "G": {
        ctx.fillStyle = pal.grass; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = world === "real" ? "rgba(0,0,0,.10)" : "rgba(0,0,0,.35)";
        ctx.fillRect(x + 3 + seed * 2, y + 6, 2, 4); ctx.fillRect(x + 11 - seed, y + 10, 2, 3);
        break;
      }
      case "P": {
        ctx.fillStyle = pal.path; ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1);
        break;
      }
      default: { // '.' 床
        ctx.fillStyle = pal.floor; ctx.fillRect(x, y, TILE, TILE);
        if (seed === 0) { ctx.fillStyle = pal.floorDot; ctx.fillRect(x + 7, y + 7, 2, 2); }
        ctx.strokeStyle = world === "real" ? "rgba(0,0,0,.05)" : "rgba(0,0,0,.3)";
        ctx.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1);
      }
    }
  }
  const OBJ_COL = {
    bed: 1, cabinet: 2, iv: 3, call: 4, window: 5, shelf: 6, sofa: 1, bookshelf: 2, tv: 3,
    counter: 4, board: 5, callmonitor: 6, table: 1, vending: 2, bench: 3, plant: 4, roofdoor: 5,
    carousel: 6, sink: 7,
  };
  function drawObject(ctx, o, world) {
    const x = o.x * TILE, y = o.y * TILE, w = o.w * TILE, h = o.h * TILE;
    const pal = PAL[world];
    if (o.kind === "roofdoor") {
      ctx.fillStyle = pal.wall; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = world === "real" ? "#777" : "#331100"; ctx.fillRect(x + 2, y + 2, w - 4, h - 2);
      ctx.strokeStyle = "#c33"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h); ctx.stroke(); ctx.lineWidth = 1;
      return;
    }
    ctx.fillStyle = pal.furniture; ctx.fillRect(x + 1, y + 2, w - 2, h - 3);
    ctx.strokeStyle = pal.furnEdge; ctx.strokeRect(x + 1.5, y + 2.5, w - 3, h - 4);
    ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.fillRect(x + 2, y + 3, w - 4, 2);
    if (w >= 26) {
      ctx.fillStyle = world === "real" ? "#555" : "#ffe6ff";
      ctx.font = FONT(7, 600); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(o.name, x + w / 2, y + h / 2 + 1, w - 4);
    }
  }
  function drawPerson(ctx, key, cx, footY, h, name, world, flip) {
    const it = Assets.get("characters/" + key);
    const w = Math.round(h * (it && it.ok ? it.img.width / it.img.height : 0.6));
    ctx.save();
    if (flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    const r = Assets.draw(ctx, "characters/" + key, cx - w / 2, footY - h, w, h, { world, label: name || key, anchor: "top", stretch: false });
    ctx.restore();
  }
  function drawHUD(ctx, m, world) {
    ctx.save();
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    // 部屋名(左上・数秒)
    if (Game.scene && Game.scene.labelT > 0) {
      ctx.font = FONT(12, 700);
      const label = m.name + (world === "other" ? " ―― 向こう側" : "");
      const lw = ctx.measureText(label).width + 14;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 0, lw + 4, 20);
      ctx.fillStyle = world === "real" ? "#eee" : "#ff2d95";
      ctx.fillText(label, 6, 4);
    }
    // 目的(上部右側・常時)
    if (state.objective) {
      ctx.font = FONT(9, 600);
      const txt = "目的:" + state.objective;
      const tw = ctx.measureText(txt).width + 12;
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(W - tw - 6, 0, tw + 4, 15);
      ctx.fillStyle = world === "real" ? "#ddd" : "#ffd23f";
      ctx.textAlign = "center"; ctx.fillText(txt, W - tw / 2 - 4, 3); ctx.textAlign = "left";
    }
    // 日付・時間(左下)
    ctx.font = FONT(9);
    ctx.fillStyle = world === "real" ? "rgba(238,238,238,.9)" : "rgba(16,0,26,.8)";
    ctx.fillRect(0, H - 13, 100, 13);
    ctx.fillStyle = world === "real" ? "#111" : "#ffd23f";
    ctx.fillText(`入院${state.day}日目・${state.time}`, 4, H - 11);
    // 空の熟れ度(右下)。向こう側では常時表示。70以上で枠が点滅
    if (state.ripeness > 0 || world === "other") {
      const gx = W - 82, gy = H - 26;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(gx - 5, gy - 11, 87, 20);
      ctx.fillStyle = "#bbb"; ctx.font = FONT(7); ctx.fillText("空の熟れ度", gx, gy - 10);
      ctx.fillStyle = "#333"; ctx.fillRect(gx, gy - 2, 62, 6);
      ctx.fillStyle = state.ripeness >= 70 ? "#ff2d2d" : state.ripeness >= 40 ? "#ffb03a" : "#29e05f";
      ctx.fillRect(gx, gy - 2, 62 * state.ripeness / 100, 6);
      if (state.ripeness >= 70) {
        ctx.fillStyle = "#ff9"; ctx.fillText("Cでナースコール", gx, gy + 6);
        if (Math.floor(performance.now() / 260) % 2 === 0) { ctx.strokeStyle = "#ff2d2d"; ctx.strokeRect(gx - 5.5, gy - 11.5, 87, 21); }
      }
    }
    ctx.restore();
  }

  /* ================= Game: 起動・ループ・画面拡大 ================= */
  function boot() {
    const canvas = document.getElementById("screen");
    Game.canvas = canvas;
    canvas.width = W * 1; canvas.height = H; // 内部解像度 320x240
    Game.ctx = canvas.getContext("2d");
    Game.buf = document.createElement("canvas"); Game.buf.width = W; Game.buf.height = H;
    Game.bctx = Game.buf.getContext("2d");
    function resize() {
      const wrap = document.getElementById("wrap") || document.body;
      const r = wrap.getBoundingClientRect();
      const availW = Math.max(80, r.width - 8), availH = Math.max(60, r.height - 8);
      let s = Math.max(1, Math.floor(Math.min(availW / W, availH / H)));
      Game.scale = s;
      canvas.style.width = W * s + "px"; canvas.style.height = H * s + "px";
    }
    window.addEventListener("resize", resize); resize();
    requestAnimationFrame(() => resize()); // レイアウト確定後にもう一度
    Game.ctx.imageSmoothingEnabled = false;

    Game.setScene("title");

    // プリロード
    const b = Game.bctx;
    Assets.preload().then(() => {
      Game.assetsReady = true;
    });
    (function drawLoad() {
      if (Game.assetsReady) return;
      b.fillStyle = "#0a0a0c"; b.fillRect(0, 0, W, H);
      b.fillStyle = "#eee"; b.font = FONT(13, 700); b.textAlign = "center";
      b.fillText("いろ", W / 2, 96);
      b.fillStyle = "#333"; b.fillRect(W / 2 - 60, 120, 120, 6);
      b.fillStyle = "#29e05f"; b.fillRect(W / 2 - 60, 120, 120 * Assets.done / Math.max(1, Assets.total), 6);
      composite();
      requestAnimationFrame(drawLoad);
    })();

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (Game.assetsReady) {
        Game.updateFX(dt);
        if (Game.scene && Game.scene.update) Game.scene.update(dt);
        const bctx = Game.bctx;
        bctx.save();
        bctx.imageSmoothingEnabled = false;
        // 全面を不透明黒で塗るのは「シーンが何も描けなかった時のみ」視える。
        // シーン描画は try/catch で守り、例外時に黒一枚画面で固まらないようにする。
        bctx.fillStyle = "#000"; bctx.fillRect(0, 0, W, H);
        let drawError = false;
        try {
          if (Game.scene && Game.scene.draw) Game.scene.draw(bctx);
        } catch (err) {
          drawError = true;
          console.error("[いろ] draw error:", err);
          bctx.fillStyle = "rgba(90,20,20,.55)"; bctx.fillRect(0, 0, W, H);
          bctx.fillStyle = "#fff"; bctx.font = FONT(11, 700); bctx.textAlign = "center"; bctx.textBaseline = "middle";
          bctx.fillText("—— 表示で問題が起きた ——", W / 2, H / 2 - 8);
          bctx.font = FONT(8); bctx.fillText("(consoleにログ。ゲームは動き続けます)", W / 2, H / 2 + 8);
        }
        // 転送オーバーレイ(背景・キャラクターまで覆う。UIより下)
        const fx = Game.fx;
        if (fx) {
          const half = fx.dur / 2;
          const a = fx.t < half ? fx.t / half : 1 - (fx.t - half) / half;
          if (fx.type === "bloom") {
            bctx.fillStyle = `rgba(255,45,149,${(0.85 * a).toFixed(3)})`; bctx.fillRect(0, 0, W, H);
            bctx.fillStyle = `rgba(41,224,95,${(0.4 * a).toFixed(3)})`;
            bctx.beginPath(); bctx.arc(W / 2, H / 2, 10 + 240 * (1 - a), 0, 7); bctx.fill();
          } else {
            bctx.fillStyle = `rgba(6,6,8,${Math.min(1, a * 1.6).toFixed(3)})`; bctx.fillRect(0, 0, W, H);
          }
        }
        // ―― 最上位レイヤー:会話UI・トースト(転送中も潰れない) ――
        if (Dialogue.active) Dialogue.draw(bctx);
        if (!drawError) {
          ctx_drawToasts(bctx);
        }
        bctx.restore();
        Input.endFrame();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    function composite() {
      const ctx = Game.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      // 現実シーンは合成時にグレースケール(§3の保険)
      const needGS = state.world === "real" && "filter" in ctx;
      if (needGS) ctx.filter = "grayscale(1) contrast(1.10) brightness(1.02)";
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(Game.buf, 0, 0);
      ctx.filter = "none";
      ctx.restore();
    }
    // 最上位レイヤーのトースト(会話ウィンドウと同じ扱いで転送オーバーレイより上)
    function ctx_drawToasts(bctx) {
      if (!Game.toasts.length) return;
      bctx.save();
      bctx.textAlign = "center"; bctx.textBaseline = "top";
      Game.toasts.forEach((tst, i) => {
        bctx.font = FONT(10, 600);
        const tw = bctx.measureText(tst.text).width + 16;
        bctx.fillStyle = "rgba(0,0,0,.7)"; bctx.fillRect(W / 2 - tw / 2, 118 - i * 18, tw, 16);
        bctx.fillStyle = "#fff"; bctx.fillText(tst.text, W / 2, 121 - i * 18);
      });
      bctx.restore();
    }

    /* 画面下のボタン(同じ操作ができる) */
    const controls = document.getElementById("controls");
    if (controls) {
      controls.addEventListener("contextmenu", (e) => e.preventDefault());
      controls.querySelectorAll("[data-key]").forEach((btn) => {
        const name = btn.getAttribute("data-key");
        const on = (e) => { e.preventDefault(); AudioSys.ensure(); Input.virtual(name, true); btn.classList.add("on"); };
        const off = (e) => { e.preventDefault(); Input.virtual(name, false); btn.classList.remove("on"); };
        btn.addEventListener("pointerdown", on);
        btn.addEventListener("pointerup", off);
        btn.addEventListener("pointerleave", off);
        btn.addEventListener("pointercancel", off);
      });
    }
    // 初回入力で音を開始
    window.addEventListener("pointerdown", () => AudioSys.ensure(), { once: true });
    window.addEventListener("keydown", () => AudioSys.ensure(), { once: true });
    // 現実/向こう側のBGMトグル(状態を定期同期。setWorld は変化時のみ動作)
    setInterval(() => { AudioSys.world !== state.world && AudioSys.setWorld(state.world); }, 500);
    // ―― デバッグ(URL に ?debug: T=世界切替 G=熟れ度+10 S=保存 B=第1戦)――
    if (/[?&]debug/.test(location.search)) {
      window.addEventListener("keydown", (e) => {
        if (e.code === "KeyT") {
          state.world = state.world === "real" ? "other" : "real";
          AudioSys.setWorld(state.world);
          Game.transition(null, "bloom");
          Game.toast(state.world === "real" ? "現実にもどった(デモ)" : "空が、熟れた(デモ)");
        } else if (e.code === "KeyG") {
          if (Game.scene && Game.scene.addRipeness) Game.scene.addRipeness(10);
        } else if (e.code === "KeyS") {
          Game.saveNow();
        } else if (e.code === "KeyB") {
          if (Game.sceneName === "explore") Game.startBattle("gyorome");
        } else if (e.code === "KeyN") {
          if (Game.sceneName === "explore") Game.startBattle("queen");
        } else if (e.code === "KeyM") {
          if (Game.sceneName === "explore") Game.startBattle("gate");
        }
      });
    }
  }
  // 後段ステージ(battle.js / director)から共有するモジュール群 ―― 全宣言の後に公開
  Game.W = W; Game.H = H; Game.TILE = TILE;
  Game.U = U; Game.PAL = PAL; Game.FONT = FONT; Game.FONT_FAMILY = FONT_FAMILY;
  Game.Input = Input; Game.Assets = Assets; Game.AudioSys = AudioSys;
  Game.Dialogue = Dialogue; Game.Save = Save;
  window.IRO = Game; // デバッグ/後段ステージからアクセス

  boot();
})();
