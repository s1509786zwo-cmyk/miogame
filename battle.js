/* ============================================================
 * 「いろ」 battle.js ―― 戦闘エンジン(アンダーテール型)+第1〜3戦
 * ・コマンドは「たたかう」「みのがす」の2つだけ
 * ・心臓カーソルで弾幕を避ける。HP20。0でミケ「ほらね」→戦闘最初から
 * ・たたかう = 攻撃バー。中央(緑)大 / 外側(黄)通常 / 端(赤)空振り
 * ・みのがす:敵ごとの条件 —— count:回数を選ぶ / survive:Nターン無被弾で耐える
 * ・第3戦「白い門番」はスクリプト戦(scripted):みのがす不可、3本バー、三本目固定
 * 第1戦 ギョロメ … みのがす×2 → 成立 / たたかう撃破 → バッド1
 * 第2戦 ハニークイーン … みのがす後3ターン無被弾 → 成立(最後のしずく)/ 撃破 → バッド2
 * 第3戦 白い門番 … 三本目を斬る → 白画面 → 現実復帰
 * ============================================================ */
(function () {
  "use strict";
  const G = window.IRO;
  const W = G.W, H = G.H, U = G.U, FONT = G.FONT;
  const Input = G.Input, Assets = G.Assets, AudioSys = G.AudioSys, Dialogue = G.Dialogue;
  const state = G.state;
  const STORY = G.STORY;

  /* ================= 敵定義 ================= */
  const ENEMIES = {
    gyorome: {
      name: "ギョロメ",
      img: "monsters/gyorome",
      hp: 16, size: 64,
      spareMode: "count", spareNeeded: 2, turnSecs: 5.5,
      intro: [
        { n: "", t: "廊下の向こうから、目玉だらけの影が、光の円を投げながら近づいてくる。" },
        { n: "ミケ", t: "「見られてるにゃ。消すにゃ」" },
        { n: "", t: "―― 戦闘:ギョロメ ――" },
      ],
      whispers: ["見られてるにゃ", "消すにゃ", "目玉は、そこら中に", "逃げるんじゃない、倒すにゃ", "……消しても、消しても"],
      sparedMsg: [
        [{ n: "", t: "影は、止まった。まだ、見ている。" }, { n: "ミケ", t: "「なぜ、消さないにゃ」" }],
        [{ n: "", t: "二回、みのがした。影は闇に溶けて、消えた。" }],
      ],
      killPages: [
        { n: "", t: "影は、簡単に消えた。" },
        { n: "", t: "それでも、消しても消しても、廊下の光は、目の形に見え続けた。" },
        { n: "ミケ", t: "「よくやったにゃ。ぜんぶ、消すにゃ」" },
      ],
      winPages: [
        { n: "", t: "影が消えたあと、澪は、自分が息を止めていたことに気づいた。" },
        { n: "ミケ", t: "「次は、もっと大きいのが来るにゃ」" },
      ],
      onWin() { state.flags.ch1gate = "spared"; G.toast("翌朝、澪は何も覚えていない"); },
      onKill() { G.badEnd("bad1"); },
      // 弾幕:光の円(狙撃)+虹彩の輪
      pattern(B, dt, spawn) {
        spawn.aimed(B, dt, Math.max(0.42, 0.8 - B.turn * 0.03), 55);
        spawn.ring(B, dt, 2.6);
      },
    },

    queen: {
      name: "ハニークイーン",
      img: "monsters/honey_queen",
      hp: 22, size: 72,
      spareMode: "survive", spareNeeded: 3, turnSecs: 6.0,
      drip: true, // 成立時「最後のしずく」演出
      intro: [
        { n: "", t: STORY.ch2[0].t },
        { n: "ミケ", t: "「毒にゃ。食べちゃだめにゃ」" },
        { n: "", t: "なぜか澪の胸が、少しだけ痛んだ。甘い匂いに、覚えがあった。" },
        { n: "", t: "―― 戦闘:ハニークイーン ――" },
      ],
      whispers: ["食べちゃだめにゃ", "甘いのは、罠にゃ", "耐えるにゃ、三度", "口を開けるな。開けるなにゃ", "……甘い、だろ"],
      spareStart: [
        { n: "ミケ", t: "「食わないにゃ。ただ、三度、耐えるにゃ」" },
        { n: "", t: "女王の腹が、低く鳴った。羽音が、鼓膜をなでる。" },
      ],
      sparedMsg: [[{ n: "", t: "一度目。澪は、逃げも、斬りもせず、耐えた。" }], [{ n: "", t: "二度目。蜜のしずくが、心臓の横をかすめていく。" }]],
      killPages: [
        { n: "", t: "女王は倒れた。羽音が、やむ。" },
        { n: "", t: "澪は、あの匂いの正体を知らないまま、現実に戻った。" },
        { n: "ミケ", t: "「よくやったにゃ。毒は、消したにゃ」" },
      ],
      winPages: [
        { n: "", t: "最後のしずくが、澪の口に、ひとつ落ちた。" },
        { n: "", t: "甘い。――覚えていたより、ずっと、甘い。" },
      ],
      onWin() { state.flags.ch2gate = "spared"; G.toast("現実に戻ると、皿の上に、ハニートースト"); },
      onKill() { G.badEnd("bad2"); },
      // 弾幕:蜜のしずく(落下・粘)と、羽音の波(横断する点の帯)
      pattern(B, dt, spawn) {
        spawn.drop(B, dt, 0.5, 30);
        spawn.wave(B, dt, 2.1);
      },
    },

    gate: {
      name: "白い門番",
      img: "monsters/gatekeeper_l",
      scripted: true, // 勝敗なし。三本バーのみの演出戦
      turnSecs: 0,
      intro: [
        { n: "ミケ", t: "「来たにゃ。『白い門番』にゃ。あいつらは君の剣を奪って、君をこの世界から閉め出そうとしているにゃ」" },
        { n: "", t: "霧の向こうから、白い巨体が三つ、ゆっくりと近づいてくる。顔はのっぺりとして、表情がない。そのうちの一体が、澪に手を伸ばした。" },
        { n: "澪", t: "「やめて……来ないで!」" },
        { n: "", t: "門番が何か言っている。くぐもった、水の底のような音だった。澪には聞き取れない。" },
        { n: "ミケ", t: "「聞いちゃだめにゃ。あれは呪文にゃ」" },
      ],
      whispers: ["聞いちゃだめにゃ", "斬るにゃ", "声が、うるさいにゃ", "白いは、敵にゃ", "今にゃ!"],
      spareDisabled: "声がうるさくて選べない",
      barPages: [
        // 各バーの直前に出る地の文
        [{ n: "", t: "一体目の腕が、振り上がる。" }],
        [{ n: "楓", t: "「澪さん! 澪さん、大丈夫、大丈夫だから!」" }],
        [{ n: "ミケ", t: "「にゃ! 今にゃ! 斬るにゃ!」" }, { n: "", t: "三本目の攻撃バーだけ、白い線が止まっていた。" }],
      ],
      barResults: [
        [{ n: "", t: "一体目の腕を、払った。" }],
        [{ n: "", t: "二体目が背後から肩をつかむ。澪は叫び、暴れ、爪を立て、体をよじった。" },
         { n: "", t: "水の底の音が、少しずつ言葉の形になっていく。" },
         { n: "", t: "三体目は、他の二体より小さかった。澪の前に立ち、両手を広げている。逃げようとも、反撃しようともしない。" }],
        [{ n: "", t: "澪は、身の力で、剣を振り下ろした。" }],
      ],
      flashPage: { n: "", t: "――画面が、白くなる――" },
      afterPages: [
        { n: "", t: "赤い空が、ひび割れた。" },
        { n: "", t: "果物の匂いが消え、薬品の匂いと、消毒液の匂いが戻ってくる。" },
        { n: "", t: "澪は、床に座り込んでいた。" },
      ],
      onEnd() { state.flags.ch3gate = "fought"; },
    },
  };

  /* ================= 共通:心臓マーク ================= */
  function drawHeart(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.9);
    ctx.bezierCurveTo(cx - s * 1.1, cy + s * 0.1, cx - s * 0.8, cy - s * 0.9, cx, cy - s * 0.25);
    ctx.bezierCurveTo(cx + s * 0.8, cy - s * 0.9, cx + s * 1.1, cy + s * 0.1, cx, cy + s * 0.9);
    ctx.fill();
  }
  const BX = 36, BY = 112, BW = W - 72, BH = 86; // 弾幕ボード
  const inBoard = (b, m) => b.x > BX - m && b.x < BX + BW + m && b.y > BY - m && b.y < BY + BH + m;

  /* ================= 弾のスポーン群 ================= */
  function makeSpawn(B) {
    return {
      aimed(B, dt, every, speed) {
        B.sp.aimed -= dt;
        if (B.sp.aimed > 0) return;
        B.sp.aimed = every;
        const side = Math.floor(Math.random() * 4);
        let x = BX + Math.random() * BW, y = BY + Math.random() * BH;
        if (side === 0) x = BX - 6; else if (side === 1) x = BX + BW + 6;
        else if (side === 2) y = BY - 6; else y = BY + BH + 6;
        const vx0 = B.px - x, vy0 = B.py - y, m = Math.hypot(vx0, vy0) || 1;
        const sp = speed + Math.random() * 16;
        B.bullets.push({ kind: "orb", x, y, vx: (vx0 / m) * sp, vy: (vy0 / m) * sp, r: 4.5 });
      },
      ring(B, dt, every) {
        B.sp.ring -= dt;
        if (B.sp.ring > 0) return;
        B.sp.ring = every;
        B.bullets.push({ kind: "ring", rad: 6, cx: BX + BW / 2, cy: BY + BH / 2, grow: 30 + B.turn * 4, rot: Math.random() * 6.28, dots: 10, life: 4.5 });
      },
      drop(B, dt, every, speed) { // 蜜のしずく:上から落ち、底で広がる
        B.sp.drop -= dt;
        if (B.sp.drop > 0) return;
        B.sp.drop = every + Math.random() * 0.25;
        B.bullets.push({ kind: "drop", x: BX + 6 + Math.random() * (BW - 12), y: BY - 6, vx: 0, vy: speed + Math.random() * 26, r: 4, acc: 26 });
      },
      wave(B, dt, every) { // 羽音の波:左から右へ、蛇行する点の帯
        B.sp.wave -= dt;
        if (B.sp.wave > 0) return;
        B.sp.wave = every;
        B.bullets.push({ kind: "wave", x: BX - 10, y: BY + 10 + Math.random() * (BH - 20), vx: 44 + B.turn * 3, amp: 5 + Math.random() * 4, ph: Math.random() * 6.28, t: 0 });
      },
    };
  }

  /* ================= 戦闘シーン本体 ================= */
  function makeBattle(data) {
    const def = ENEMIES[data.id] || ENEMIES.gyorome;
    const scripted = !!def.scripted;
    const B = {
      id: data.id,
      phase: "say", t: 0, animT: 0,
      menuSel: 0, spareCount: 0, spareActive: false, endured: 0, noHitTurn: true,
      hp: 20, maxHp: 20,
      enemyHp: def.hp || 0,
      turn: 0, turnT: 0,
      px: 160, py: 155, invuln: 0, hitFlash: 0,
      bullets: [], sp: { aimed: 1, ring: 2, drop: 1.2, wave: 2.4 },
      barPos: 0, barDir: 1, barLocked: -1, barResult: "", dmgFlash: 0,
      gateIdx: 0, gatePos: 0, gateDir: 1, gateRes: [],
      dripT: 0, flashT: 0,
      shake: 0, whisperIdx: 0, whisperT: 0, deadT: 0,
    };
    const spawn = makeSpawn(B);

    /* ---- フェーズ ---- */
    function toMenu() { B.phase = "menu"; B.menuSel = 0; B.turn++; B.bullets = []; }
    function say(pages, next) { Dialogue.open(pages, () => next()); B.phase = "say"; B.next = next; }
    function startEnemyTurn() {
      B.phase = "enemy"; B.turnT = 0; B.bullets = []; B.noHitTurn = true;
      B.px = BX + BW / 2; B.py = BY + BH / 2;
    }
    function loseAll() { B.phase = "dead"; B.deadT = 0; AudioSys.sfx("bad"); }
    function resetBattle() {
      B.spareCount = 0; B.spareActive = false; B.endured = 0;
      B.enemyHp = def.hp || 0; B.hp = B.maxHp; B.turn = 0;
      B.bullets = []; B.deadT = 0; B.gateIdx = 0; B.gateRes = [];
      if (scripted) say(def.intro, () => { B.phase = "menu"; });
      else say(def.intro, toMenu);
    }
    function victoryFlow() {
      if (def.drip) { B.phase = "drip"; B.dripT = 0; }
      else say(def.winPages, () => { def.onWin && def.onWin(); G.endBattle(); });
    }
    function judgeBar() {
      const d = Math.abs(B.barPos - 0.5);
      let dmg = 0;
      if (d <= 0.055) { dmg = 6; B.barResult = "クリティカル!"; }
      else if (d <= 0.2) { dmg = 3; B.barResult = "命中"; }
      else { dmg = 0; B.barResult = "ミス!"; }
      B.barLocked = B.barPos;
      B.enemyHp -= dmg; B.dmgFlash = 0.5;
      AudioSys.sfx(dmg > 0 ? "heal" : "cancel");
      if (dmg > 0) AudioSys.beep(200, 0.08, "square", 0.4, 90);
    }

    /* ---- 弾の移動と被弾 ---- */
    function updateBullets(dt) {
      if (def.pattern) def.pattern(B, dt, spawn);
      for (let i = B.bullets.length - 1; i >= 0; i--) {
        const b = B.bullets[i];
        if (b.kind === "ring") {
          b.rad += b.grow * dt; b.life -= dt;
          if (b.rad > BW || b.life <= 0) { B.bullets.splice(i, 1); continue; }
        } else if (b.kind === "drop") {
          b.vy += (b.acc || 24) * dt;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.y > BY + BH - 4) { b.splat = (b.splat || 0) + dt; if (b.splat > 0.8) { B.bullets.splice(i, 1); continue; } b.vy = 0; }
        } else if (b.kind === "wave") {
          b.t += dt; b.x += b.vx * dt;
          if (b.x > BX + BW + 10) { B.bullets.splice(i, 1); continue; }
        } else {
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (!inBoard(b, 16)) { B.bullets.splice(i, 1); continue; }
        }
        if (B.invuln <= 0) {
          let hit = false;
          if (b.kind === "ring") {
            for (let k = 0; k < b.dots && !hit; k++) {
              const a = b.rot + k * (6.2831 / b.dots);
              const dx = b.cx + Math.cos(a) * b.rad - B.px, dy = b.cy + Math.sin(a) * b.rad - B.py;
              if (dx * dx + dy * dy < 64) hit = true;
            }
          } else if (b.kind === "wave") {
            for (let k = -3; k <= 3 && !hit; k++) {
              const wx2 = b.x + k * 7;
              if (wx2 < BX || wx2 > BX + BW) continue;
              const wy2 = b.y + Math.sin(b.t * 5 + b.ph + k * 0.7) * b.amp;
              const dx = wx2 - B.px, dy = wy2 - B.py;
              if (dx * dx + dy * dy < 42) hit = true;
            }
          } else {
            const dx = b.x - B.px, dy = b.y - B.py;
            const rr = (b.r || 4) + 4;
            if (dx * dx + dy * dy < rr * rr) hit = true;
          }
          if (hit) {
            B.hp -= 2; B.invuln = 0.8; B.hitFlash = 0.35; B.shake = 5;
            B.noHitTurn = false; B.endured = 0; // 耐えカウンターは被弾でリセット
            AudioSys.beep(110, 0.16, "sawtooth", 0.5, 60);
            if (B.hp <= 0) { B.hp = 0; loseAll(); return; }
          }
        }
      }
      if (B.invuln > 0) B.invuln -= dt;
    }
    function drawBullets(ctx) {
      for (const b of B.bullets) {
        if (b.kind === "ring") {
          for (let k = 0; k < b.dots; k++) {
            const a = b.rot + k * (6.2831 / b.dots);
            eyeDot(ctx, b.cx + Math.cos(a) * b.rad, b.cy + Math.sin(a) * b.rad, 4, "#ffd23f");
          }
        } else if (b.kind === "drop") {
          honeyDot(ctx, b.x, b.y, b.r, b);
        } else if (b.kind === "wave") {
          honeyDot(ctx, 0, 0, 3.2, b);
        } else eyeDot(ctx, b.x, b.y, b.r, "#ffd23f");
      }
    }
    function eyeDot(ctx, x, y, r, c) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.fillStyle = "#1a0026";
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, r * 0.45), 0, 7); ctx.fill();
      ctx.fillStyle = "#ff2d95";
      ctx.fillRect(x - 0.5, y - r, 1, r);
    }
    function honeyDot(ctx, x, y, r, b) {
      if (b.kind === "drop") {
        ctx.fillStyle = "#ffb03a";
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.6);
        ctx.quadraticCurveTo(x + r, y - r * 0.2, x, y + r);
        ctx.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.6);
        ctx.fill();
        if (b.splat) { ctx.globalAlpha = 0.7; ctx.fillStyle = "#ffb03a"; ctx.fillRect(x - r * 1.6, BY + BH - 3, r * 3.2, 2); ctx.globalAlpha = 1; }
      } else {
        for (let k = -3; k <= 3; k++) {
          const wx2 = b.x + k * 7;
          if (wx2 < BX || wx2 > BX + BW) continue;
          const wy2 = b.y + Math.sin(b.t * 5 + b.ph + k * 0.7) * b.amp;
          ctx.fillStyle = "rgba(255,210,63,.9)";
          ctx.fillRect(wx2 - 1, wy2 - 1, 2, 2);
        }
      }
    }

    /* ---- 第3戦:3本バー ---- */
    function gatePress() {
      const d = Math.abs(B.gatePos - 0.5);
      const res = B.gateIdx === 2 ? "渾身!" : d <= 0.055 ? "命中!" : d <= 0.2 ? "かすめた" : "空振り";
      B.gateRes[B.gateIdx] = res;
      AudioSys.beep(200 + (d <= 0.055 || B.gateIdx === 2 ? 160 : 0), 0.08, "square", 0.4, 90);
      const i = B.gateIdx;
      B.phase = "say";
      say(def.barResults[i], () => {
        if (i < 2) { B.gateIdx++; B.gatePos = 0; B.gateDir = 1; say(def.barPages[B.gateIdx], () => { B.phase = "gatebar"; }); }
        else gateFinish();
      });
    }
    function gateFinish() {
      B.flashT = 0; B.phase = "gateFlash";
      AudioSys.sfx("bloom");
    }

    /* ---- update ---- */
    return {
      debug() { return { phase: B.phase, menuSel: B.menuSel, spareCount: B.spareCount, spareActive: B.spareActive, endured: B.endured, enemyHp: B.enemyHp, hp: B.hp, turn: B.turn, barPos: B.barPos, gateIdx: B.gateIdx, gatePos: B.gatePos }; },
      cheat(k, v) { if (k in B) { B[k] = v; return true; } return false; },
      init() {
        if (scripted) say(def.intro, () => { B.phase = "menu"; });
        else say(def.intro, toMenu);
      },
      update(dt) {
        B.animT += dt; B.t += dt;
        B.whisperT += dt;
        if (B.whisperT > 3.4) { B.whisperT = 0; B.whisperIdx = (B.whisperIdx + 1) % def.whispers.length; }
        if (B.shake > 0) B.shake = Math.max(0, B.shake - dt * 18);
        if (B.hitFlash > 0) B.hitFlash -= dt;
        if (B.dmgFlash > 0) B.dmgFlash -= dt;

        if (B.phase === "say") { Dialogue.update(dt); return; }
        if (B.phase === "dead") { B.deadT += dt; if (B.deadT > 1.6) resetBattle(); return; }

        if (B.phase === "menu") {
          if (Input.pressed.up || Input.pressed.left) {
            if (B.menuSel === 1) { B.menuSel = 0; AudioSys.sfx("select"); }
          }
          if (Input.pressed.down || Input.pressed.right) {
            if (scripted) { G.toast(def.spareDisabled); AudioSys.sfx("cancel"); } // 「声がうるさくて選べない」
            else if (B.menuSel === 0) { B.menuSel = 1; AudioSys.sfx("select"); }
          }
          if (Input.pressed.z) {
            AudioSys.ensure();
            if (B.menuSel === 0) {
              if (scripted) { B.gateIdx = 0; B.gatePos = 0; B.gateDir = 1; say(def.barPages[0], () => { B.phase = "gatebar"; }); }
              else { B.phase = "bar"; B.barPos = 0; B.barDir = 1; B.barLocked = -1; B.barResult = ""; AudioSys.beep(520, 0.06, "square", 0.4, 900); }
            } else if (def.spareMode === "count") {
              B.spareCount++;
              if (B.spareCount >= def.spareNeeded) {
                say(def.sparedMsg[def.sparedMsg.length - 1], victoryFlow);
              } else {
                say(def.sparedMsg[Math.min(B.spareCount - 1, def.sparedMsg.length - 1)], startEnemyTurn);
              }
            } else if (def.spareMode === "survive") {
              if (!B.spareActive) {
                B.spareActive = true;
                say(def.spareStart, startEnemyTurn);
              } else {
                say([{ n: "", t: "耐えている。王は、まだ蜜を垂らしている。" }], startEnemyTurn);
              }
            }
          }
        } else if (B.phase === "bar") {
          if (B.barLocked < 0) {
            const sp = 0.95 + B.turn * 0.02;
            B.barPos += B.barDir * dt * sp;
            if (B.barPos > 1) { B.barPos = 1; B.barDir = -1; }
            if (B.barPos < 0) { B.barPos = 0; B.barDir = 1; }
            if (Input.pressed.z) { judgeBar(); B.phase = "barResult"; B.t = 0; }
          }
        } else if (B.phase === "barResult") {
          B.t += dt;
          if (B.t > 0.7) {
            if (B.enemyHp <= 0) say(def.killPages, () => { def.onKill && def.onKill(); });
            else startEnemyTurn();
          }
        } else if (B.phase === "enemy") {
          B.turnT += dt;
          let mx = 0, my = 0;
          if (Input.down.left) mx -= 1; if (Input.down.right) mx += 1;
          if (Input.down.up) my -= 1; if (Input.down.down) my += 1;
          const sp = 86 * dt;
          if (mx && my) { mx *= 0.7071; my *= 0.7071; }
          B.px = U.clamp(B.px + mx * sp, BX + 6, BX + BW - 6);
          B.py = U.clamp(B.py + my * sp, BY + 6, BY + BH - 6);
          updateBullets(dt);
          if (B.phase === "enemy" && B.turnT >= def.turnSecs) {
            if (B.spareActive && def.spareMode === "survive") {
              if (B.noHitTurn) B.endured++;
              else B.endured = 0;
              if (B.endured >= def.spareNeeded) { victoryFlow(); return; }
              if (B.endured > 0) { // 被弾でリセットされた回はメッセージなし
                say(def.sparedMsg[Math.min(B.endured - 1, def.sparedMsg.length - 1)], toMenu);
                return;
              }
            }
            toMenu();
          }
        } else if (B.phase === "drip") { // 最後のしずく演出
          B.dripT += dt;
          if (B.dripT > 1.9) say(def.winPages, () => { def.onWin && def.onWin(); G.endBattle(); });
        } else if (B.phase === "gatebar") {
          if (B.gateIdx < 2) {
            B.gatePos += B.gateDir * dt * 0.9;
            if (B.gatePos > 1) { B.gatePos = 1; B.gateDir = -1; }
            if (B.gatePos < 0) { B.gatePos = 0; B.gateDir = 1; }
          } else B.gatePos = 0.5; // 三本目だけ、白い線が止まっている
          if (Input.pressed.z) gatePress();
        } else if (B.phase === "gateFlash") {
          B.flashT += dt;
          if (B.flashT > 1.2) say([def.flashPage].concat(def.afterPages), () => { def.onEnd && def.onEnd(); G.endBattle(); });
        }
      },

      /* ---- draw ---- */
      draw(ctx) {
        Assets.draw(ctx, "bg/battle_bg_123", 0, 0, W, H, { world: "other", stretch: true, label: false });
        ctx.fillStyle = "rgba(26,0,38,.55)"; ctx.fillRect(0, 0, W, H);
        const shakeX = B.shake ? (Math.random() - 0.5) * B.shake : 0;
        ctx.save(); ctx.translate(shakeX, 0);

        // 敵
        if (scripted) { // 門番三体:左右に大型、中央前に小型(両手を広げている)
          const t = Math.sin(B.animT * 0.9) * 2;
          Assets.draw(ctx, "monsters/gatekeeper_l", 26, 34 + t, 58, 74, { world: "other", label: "門番" });
          Assets.draw(ctx, "monsters/gatekeeper_l", 236, 34 - t, 58, 74, { world: "other", label: "門番" });
          const smallAlpha = B.gateIdx >= 1 ? 1 : 0.9;
          ctx.globalAlpha = smallAlpha;
          Assets.draw(ctx, "monsters/gatekeeper_s", 132, 52 + t * 0.5, 56, 46, { world: "other", label: "門番?" });
          ctx.globalAlpha = 1;
          ctx.font = FONT(10, 700); ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillStyle = "#e8e8f4";
          ctx.fillText(def.name, W / 2, 100);
        } else {
          const ey = 40 + Math.round(Math.sin(B.animT * 1.6) * 2);
          const ex = W / 2 - def.size / 2;
          Assets.draw(ctx, def.img, ex, ey, def.size, def.size, { world: "other", label: def.name, seed: B.id.length });
          if (B.dmgFlash > 0.25) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(ex, ey, def.size, def.size); }
          ctx.font = FONT(10, 700); ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillStyle = "#ffd23f";
          ctx.fillText(B.enemyHp > 0 ? def.name : "――", W / 2, 100);
          // みのがし進行(✚)
          for (let s = 0; s < (def.spareNeeded || 0); s++) {
            const done = def.spareMode === "survive" ? s < B.endured : s < B.spareCount;
            ctx.fillStyle = done ? "#29e05f" : "rgba(255,255,255,.28)";
            ctx.font = FONT(12, 700);
            ctx.fillText("✚", W / 2 + 34 + s * 12, 99);
          }
        }

        // ミケの囁き(右端縦)と立ち絵
        ctx.textAlign = "center"; ctx.font = FONT(9);
        const wsp = def.whispers[B.whisperIdx];
        for (let c = 0; c < wsp.length; c++) {
          ctx.fillStyle = c === 0 ? "#29e05f" : "rgba(255,45,149,.85)";
          ctx.fillText(wsp[c], W - 10, 12 + c * 11);
        }
        Assets.draw(ctx, "monsters/mike", 4, 78, 24, 24, { world: "other", label: "ミケ" });

        // ボード枠
        ctx.strokeStyle = "#f2f2f2"; ctx.lineWidth = 2;
        ctx.strokeRect(BX - 0.5, BY - 0.5, BW + 1, BH + 1);

        if (B.phase === "bar" || B.phase === "barResult") drawAttackBar(ctx);
        else if (B.phase === "gatebar") drawGateBars(ctx);
        else if (B.phase === "enemy") {
          drawBullets(ctx);
          if (!(B.invuln > 0 && Math.floor(B.animT * 12) % 2 === 0))
            drawHeart(ctx, B.px, B.py, 4.5, "#ff2d2d");
          if (B.spareActive && def.spareMode === "survive") {
            ctx.fillStyle = "#29e05f"; ctx.font = FONT(8); ctx.textAlign = "left";
            ctx.fillText("耐え " + B.endured + "/" + def.spareNeeded + "(被弾でリセット)", BX, BY - 12);
          }
        } else if (B.phase === "drip") {
          // 女王の攻撃が止まり、最後のしずくが澪の口へ
          drawHeart(ctx, B.px, B.py, 4.5, "#ff2d2d");
          const p = U.clamp(B.dripT / 1.5, 0, 1);
          const yy = BY - 4 + p * (B.py - BY + 10);
          if (p < 1) honeyDot(ctx, B.px, yy, 5, { kind: "drop", splat: 0 });
          else { // 口に含んだ後の、金色の波紋
            ctx.strokeStyle = "rgba(255,176,58,.9)";
            const r = 6 + (B.dripT - 1.5) * 30;
            ctx.beginPath(); ctx.arc(B.px, B.py, r, 0, 7); ctx.stroke();
          }
          ctx.fillStyle = "#ffd23f"; ctx.font = FONT(10, 700); ctx.textAlign = "center";
          ctx.fillText("―― 女王の攻撃が、止まった ――", W / 2, BY + BH / 2 - 22);
        }

        // HP
        ctx.textAlign = "left"; ctx.font = FONT(10, 700);
        ctx.fillStyle = "#f2e8ff"; ctx.fillText("澪", 12, H - 36);
        ctx.fillStyle = "#ffd23f"; ctx.fillText("Lv 19", 34, H - 36);
        const hx = 74, hy = H - 34;
        ctx.fillStyle = "#111"; ctx.font = FONT(9);
        ctx.fillText("HP", hx - 16, hy - 1);
        for (let i = 0; i < 10; i++) {
          const v = B.hp - i * 2;
          ctx.fillStyle = v >= 2 ? "#ff2d95" : v === 1 ? "#ffb03a" : "rgba(255,255,255,.18)";
          ctx.fillRect(hx + i * 10, hy, 8, 8);
        }
        ctx.fillStyle = "#fff"; ctx.font = FONT(9);
        ctx.fillText(`${B.hp} / ${B.maxHp}`, hx + 106, hy);

        // コマンド
        if (B.phase === "menu") {
          const cmds = [{ t: "たたかう", gray: false }, { t: "みのがす", gray: scripted }];
          cmds.forEach((c, i) => {
            const x = 44 + i * 120, y = H - 22;
            ctx.fillStyle = i === B.menuSel ? "#2a0b3d" : "rgba(0,0,0,.35)";
            ctx.fillRect(x, y, 108, 16);
            ctx.strokeStyle = c.gray ? "#555" : (i === B.menuSel ? "#29e05f" : "#777");
            ctx.strokeRect(x + 0.5, y + 0.5, 107, 15);
            if (i === B.menuSel) drawHeart(ctx, x + 10, y + 8, 3.4, "#ff2d2d");
            ctx.fillStyle = c.gray ? "#5a5a5a" : (i === B.menuSel ? "#fff" : "#bbb");
            ctx.font = FONT(10, 700); ctx.textAlign = "center";
            ctx.fillText(c.t, x + 60, y + 3);
          });
          ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = FONT(8);
          ctx.fillText("↑↓:えらぶ Z:きめる", 32, 100);
        }

        // ミケ「ほらね」(HP0)
        if (B.phase === "dead") {
          ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = "#ff2d95"; ctx.font = FONT(14, 700); ctx.textAlign = "center";
          ctx.fillText("「ほらね」", W / 2, 100);
          ctx.fillStyle = "#eee"; ctx.font = FONT(9);
          ctx.fillText("……戦闘を、はじめからやり直すにゃ", W / 2, 124);
        }
        // 門番戦の白画面
        if (B.phase === "gateFlash") {
          ctx.fillStyle = `rgba(255,255,255,${U.clamp(B.flashT / 0.8, 0, 1).toFixed(3)})`;
          ctx.fillRect(-8, -8, W + 16, H + 16);
        }
        ctx.restore();

        if (B.phase === "barResult" && B.barResult) {
          ctx.fillStyle = B.barResult.indexOf("クリ") === 0 ? "#29e05f" : B.barResult === "ミス!" ? "#ff2d2d" : "#ffd23f";
          ctx.font = FONT(11, 700); ctx.textAlign = "center";
          ctx.fillText(B.barResult, W / 2, BY - 16);
        }
        // 会話ウィンドウは frame() 側の最上位レイヤーで描画される(黒スクリーン化防止)
      },
    };
    function drawAttackBar(ctx) {
      const bx = BX + 10, by = BY + 30, bw = BW - 20, bh = 26;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "rgba(255,45,45,.5)"; ctx.fillRect(bx, by, bw * 0.30, bh); ctx.fillRect(bx + bw * 0.70, by, bw * 0.30, bh);
      ctx.fillStyle = "rgba(255,210,63,.55)"; ctx.fillRect(bx + bw * 0.30, by, bw * 0.40, bh);
      ctx.fillStyle = "rgba(41,224,95,.8)"; ctx.fillRect(bx + bw * 0.445, by, bw * 0.11, bh);
      const p = B.barLocked >= 0 ? B.barLocked : B.barPos;
      ctx.fillStyle = "#fff"; ctx.fillRect(bx + p * bw - 1, by - 4, 2, bh + 8);
      ctx.strokeStyle = "#f2f2f2"; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = "#eee"; ctx.font = FONT(9); ctx.textAlign = "center";
      ctx.fillText(B.barLocked >= 0 ? "" : "Zで、止めろ", bx + bw / 2, by - 16);
    }
    function drawGateBars(ctx) {
      const bw = BW - 20;
      for (let i = 0; i < 3; i++) {
        const bx = BX + 10, by = BY + 8 + i * 26, bh = 18;
        const active = i === B.gateIdx;
        ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "rgba(41,224,95,.65)"; ctx.fillRect(bx + bw * 0.445, by, bw * 0.11, bh);
        if (B.gateRes[i]) {
          ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = "#29e05f"; ctx.font = FONT(9, 700); ctx.textAlign = "right";
          ctx.fillText(B.gateRes[i], bx + bw - 4, by + 4);
        } else if (active) {
          const p = i === 2 ? 0.5 : B.gatePos;
          ctx.fillStyle = "#fff"; ctx.fillRect(bx + p * bw - 1, by - 3, 2, bh + 6);
          ctx.fillStyle = "#ffd23f"; ctx.font = FONT(8); ctx.textAlign = "left";
          ctx.fillText(i === 2 ? "三本目だけ、線が止まっている" : "Zで、止めろ", bx + 4, by - 12);
        }
        ctx.strokeStyle = active ? "#fff" : "#666";
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      }
      ctx.fillStyle = "#888"; ctx.font = FONT(8); ctx.textAlign = "center";
      ctx.fillText("みのがすは選べない", W / 2, BY + 8 + 3 * 26);
    }
  }

  /* ================= バッドエンドシーン ================= */
  function makeBadEnd(data) {
    const key = data.key;
    const bd = G.STORY.badEnds[key] || { title: "バッドエンド", text: ["……"], hint: "" };
    let i = 0;
    const pages = [{ n: "", t: bd.title }].concat(bd.text.map((t) => ({ n: "", t })));
    if (bd.hint) pages.push({ n: "", t: "―― ヒント ――" }, { n: "", t: "「" + bd.hint + "」" });
    pages.push({ n: "", t: "タイトルにもどる。直前の関門から、やり直せる(関門実装はステージ4)。" });
    return {
      init() { /* 暗転は Game.badEnd() 側が既に開始済み。ここで二重に転送しない(過剰な黒被りの原因) */ },
      update(dt) {
        if (Input.pressed.z) {
          if (i < pages.length - 1) { i++; AudioSys.sfx("tick"); }
          else G.transition(() => G.setScene("title"), "fade");
        }
        if (Input.pressed.x && i > 0) i--;
      },
      draw(ctx) {
        ctx.fillStyle = "#050506"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,45,45,.06)"; ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = FONT(13, 700); ctx.fillStyle = "#c8324b";
        ctx.fillText(pages[0].t, W / 2, 34);
        ctx.font = FONT(11); ctx.fillStyle = "#d8d8d8";
        const cur = pages[Math.min(i, pages.length - 1)];
        const lines = U.wrapJP(cur.t, 24);
        lines.forEach((l, k) => ctx.fillText(l, W / 2, 84 + k * 18));
        if (Math.floor(performance.now() / 400) % 2 === 0) {
          ctx.fillStyle = "#666"; ctx.font = FONT(8);
          ctx.fillText("Z:つぎへ " + (i + 1) + "/" + pages.length, W / 2, H - 14);
        }
      },
    };
  }

  G.registerScene("battle", makeBattle);
  G.registerScene("badend", makeBadEnd);
  G.ENEMIES = ENEMIES; // ステージ4・5で ch進行から起動する(hani→gate→witch)
})();
