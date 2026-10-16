/* ============================================================
 * 「いろ」 battle.js ―― 戦闘エンジン(アンダーテール型)+第1戦
 * ・コマンドは「たたかう」「みのがす」の2つだけ
 * ・心臓カーソルで弾幕を避ける。HP20。0でミケ「ほらね」→戦闘最初から
 * ・たたかう = 攻撃バー。中央(緑)大 / 外側(黄)通常 / 端(赤)空振り
 * ・ミケの囁きは画面端に常時表示
 * 第1戦「ギョロメ」: みのがす×2で成立 / たたかうで倒すとバッド1
 * ============================================================ */
(function () {
  "use strict";
  const G = window.IRO;
  const W = G.W, H = G.H, U = G.U, FONT = G.FONT;
  const Input = G.Input, Assets = G.Assets, AudioSys = G.AudioSys, Dialogue = G.Dialogue;
  const state = G.state;

  /* ---------------- 敵定義(戦闘ごとの仕様 §6) ---------------- */
  const ENEMIES = {
    gyorome: {
      name: "ギョロメ",
      img: "monsters/gyorome",
      hp: 16, size: 64,
      spareNeeded: 2, turnSecs: 5.5,
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
      // 「たたかう」で倒したとき(勝てるが、そのままバッド1へ)
      killPages: [
        { n: "", t: "影は、簡単に消えた。" },
        { n: "", t: "それでも、消しても消しても、廊下の光は、目の形に見え続けた。" },
        { n: "ミケ", t: "「よくやったにゃ。ぜんぶ、消すにゃ」" },
      ],
      winPages: [
        { n: "", t: "影が消えたあと、澪は、自分が息を止めていたことに気づいた。" },
        { n: "ミケ", t: "「次は、もっと大きいのが来るにゃ」" },
      ],
      onWin() { // ステージ4では director が章を進行させる
        state.flags.ch1gate = "spared";
        G.toast("翌朝、澪は何も覚えていない");
      },
      onKill() { G.badEnd("bad1"); },
    },
  };

  /* ---------------- 共通:心臓マークの描画 ---------------- */
  function drawHeart(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.9);
    ctx.bezierCurveTo(cx - s * 1.1, cy + s * 0.1, cx - s * 0.8, cy - s * 0.9, cx, cy - s * 0.25);
    ctx.bezierCurveTo(cx + s * 0.8, cy - s * 0.9, cx + s * 1.1, cy + s * 0.1, cx, cy + s * 0.9);
    ctx.fill();
  }

  /* ---------------- 戦闘シーン本体 ---------------- */
  function makeBattle(data) {
    const def = ENEMIES[data.id] || ENEMIES.gyorome;
    const B = {
      id: data.id,
      phase: "intro", t: 0, animT: 0,
      menuSel: 0, spareCount: 0,
      hp: 20, maxHp: 20,
      enemyHp: def.hp,
      turn: 0, turnT: 0,
      px: 160, py: 170, invuln: 0, hitFlash: 0,
      bullets: [], spawnA: 0, spawnR: 0, ringPhase: 0, ringActive: -1,
      barPos: 0, barDir: 1, barLocked: -1, barResult: "", dmgFlash: 0,
      shake: 0, whisperIdx: 0, whisperT: 0, deadT: 0,
    };
    const BX = 36, BY = 112, BW = W - 72, BH = 86; // 弾幕ボード(下にHP列とメニュー列)

    /* ---- フェーズ遷移 ---- */
    function toMenu() {
      B.phase = "menu"; B.menuSel = 0; B.turn++;
      B.bullets = [];
    }
    function say(pages, next) {
      Dialogue.open(pages, () => { next(); });
      B.phase = "say"; B.next = next;
    }
    function loseAll() { // HP 0:ミケ「ほらね」→戦闘を最初から
      B.phase = "dead"; B.deadT = 0;
      AudioSys.sfx("bad");
    }
    function resetBattle() {
      B.spareCount = 0; B.enemyHp = def.hp; B.hp = B.maxHp; B.turn = 0;
      B.bullets = []; B.deadT = 0;
      say(def.intro, toMenu);
    }

    /* ---- 攻撃判定 ---- */
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

    /* ---- 弾幕(第1戦:光の円) ---- */
    function updateBullets(dt) {
      B.spawnA -= dt; B.spawnR -= dt; B.ringPhase += dt * 1.15;
      if (B.spawnA <= 0) { // 縁から、プレイヤーを狙う光の円
        B.spawnA = Math.max(0.42, 0.8 - B.turn * 0.03);
        const side = Math.floor(Math.random() * 4);
        let x = BX + Math.random() * BW, y = BY + Math.random() * BH, sx = 0, sy = 0;
        if (side === 0) { x = BX - 6; sx = 1; } else if (side === 1) { x = BX + BW + 6; sx = -1; }
        else if (side === 2) { y = BY - 6; sy = 1; } else { y = BY + BH + 6; sy = -1; }
        if (sx) x = sx > 0 ? BX - 6 : BX + BW + 6;
        if (sy) y = sy > 0 ? BY - 6 : BY + BH + 6;
        const vx0 = B.px - x, vy0 = B.py - y, m = Math.hypot(vx0, vy0) || 1;
        const sp = 52 + Math.random() * 16;
        B.bullets.push({ x, y, vx: (vx0 / m) * sp, vy: (vy0 / m) * sp, r: 4.5, kind: "orb" });
      }
      if (B.spawnR <= 0) { // 虹彩の輪
        B.spawnR = 2.6;
        B.bullets.push({ ring: 1, rad: 6, cx: BX + BW / 2, cy: BY + BH / 2, grow: 30 + B.turn * 4, rot: Math.random() * 6.28, dots: 10, kind: "ring", life: 4.5 });
      }
      for (let i = B.bullets.length - 1; i >= 0; i--) {
        const b = B.bullets[i];
        if (b.kind === "ring") {
          b.rad += b.grow * dt; b.life -= dt;
          if (b.rad > BW || b.life <= 0) { B.bullets.splice(i, 1); continue; }
        } else {
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x < BX - 14 || b.x > BX + BW + 14 || b.y < BY - 14 || b.y > BY + BH + 14) { B.bullets.splice(i, 1); continue; }
        }
        // 当たり判定
        if (B.invuln <= 0) {
          let hit = false;
          if (b.kind === "ring") {
            for (let k = 0; k < b.dots; k++) {
              const a = b.rot + k * (6.2831 / b.dots);
              const dx = b.cx + Math.cos(a) * b.rad - B.px, dy = b.cy + Math.sin(a) * b.rad - B.py;
              if (dx * dx + dy * dy < 64) { hit = true; break; }
            }
          } else {
            const dx = b.x - B.px, dy = b.y - B.py;
            if (dx * dx + dy * dy < (b.r + 4) * (b.r + 4)) hit = true;
          }
          if (hit) {
            B.hp -= 2; B.invuln = 0.8; B.hitFlash = 0.35; B.shake = 5;
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
            eyeDot(ctx, b.cx + Math.cos(a) * b.rad, b.cy + Math.sin(a) * b.rad, 4);
          }
        } else eyeDot(ctx, b.x, b.y, b.r);
      }
    }
    function eyeDot(ctx, x, y, r) { // 「光の円」=瞳孔つきの円環
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.fillStyle = "#1a0026";
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, r * 0.45), 0, 7); ctx.fill();
      ctx.fillStyle = "#ff2d95";
      ctx.fillRect(x - 0.5, y - r, 1, r);
    }

    /* ---- update ---- */
    const scene = {
      debug() { return { phase: B.phase, menuSel: B.menuSel, spareCount: B.spareCount, enemyHp: B.enemyHp, hp: B.hp, turn: B.turn, barPos: B.barPos }; },
      cheat(k, v) { if (k in B) { B[k] = v; return true; } return false; }, // バランス調整/検証用
      init() { say(def.intro, toMenu); },
      update(dt) {
        B.animT += dt; B.t += dt;
        B.whisperT += dt;
        if (B.whisperT > 3.4) { B.whisperT = 0; B.whisperIdx = (B.whisperIdx + 1) % def.whispers.length; }
        if (B.shake > 0) B.shake = Math.max(0, B.shake - dt * 18);
        if (B.hitFlash > 0) B.hitFlash -= dt;
        if (B.dmgFlash > 0) B.dmgFlash -= dt;

        if (B.phase === "say") { Dialogue.update(dt); return; }
        if (B.phase === "dead") {
          B.deadT += dt;
          if (B.deadT > 1.6) resetBattle();
          return;
        }
        if (Input.pressed.x && B.phase === "menu") { AudioSys.sfx("cancel"); }

        if (B.phase === "menu") {
          if (Input.pressed.up || Input.pressed.left) { B.menuSel = 0; AudioSys.sfx("select"); }
          if (Input.pressed.down || Input.pressed.right) { B.menuSel = 1; AudioSys.sfx("select"); }
          if (Input.pressed.z) {
            AudioSys.ensure();
            if (B.menuSel === 0) { // たたかう → 攻撃バー
              B.phase = "bar"; B.barPos = 0; B.barDir = 1; B.barLocked = -1; B.barResult = "";
              AudioSys.beep(520, 0.06, "square", 0.4, 900);
            } else { // みのがす
              B.spareCount++;
              if (B.spareCount >= def.spareNeeded) {
                say(def.sparedMsg[def.sparedMsg.length - 1], () => {
                  say(def.winPages, () => { def.onWin && def.onWin(); G.endBattle(); });
                });
              } else {
                say(def.sparedMsg[Math.min(B.spareCount - 1, def.sparedMsg.length - 1)], startEnemyTurn);
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
            if (B.enemyHp <= 0) { // 倒してしまう → 演出のちバッド1
              say(def.killPages, () => { def.onKill && def.onKill(); });
            } else startEnemyTurn();
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
          if (B.phase === "enemy" && B.turnT >= def.turnSecs) { // 弾幕を凌ぎ切る → メニュー
            if (B.spareCount >= def.spareNeeded) return; // (安全側)
            toMenu();
          }
        }
      },
      /* ---- draw ---- */
      draw(ctx) {
        // 背景:熟れた色。バッド/現実寄りの瞬間もあるため world 判定
        Assets.draw(ctx, "bg/battle_bg_123", 0, 0, W, H, { world: "other", stretch: true, label: false });
        ctx.fillStyle = "rgba(26,0,38,.55)"; ctx.fillRect(0, 0, W, H);
        const shakeX = B.shake ? (Math.random() - 0.5) * B.shake : 0;
        ctx.save(); ctx.translate(shakeX, 0);

        // 敵
        const ey = 40 + Math.round(Math.sin(B.animT * 1.6) * 2);
        const ex = W / 2 - def.size / 2;
        if (B.enemyHp > 0 || B.phase === "barResult" || B.phase === "say") {
          const alpha = B.enemyHp <= 0 ? Math.max(0, 1 - (B.dmgFlash > 0 ? 0.2 : 0)) : 1;
          ctx.globalAlpha = alpha;
          Assets.draw(ctx, def.img, ex, ey, def.size, def.size, { world: "other", label: def.name, seed: B.id.length });
          ctx.globalAlpha = 1;
          if (B.dmgFlash > 0.25) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(ex, ey, def.size, def.size); }
        }
        // 敵名 + みのがし進行(✚)
        ctx.font = FONT(10, 700); ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillStyle = "#ffd23f";
        ctx.fillText(B.enemyHp > 0 ? def.name : "――", W / 2, 100);
        for (let s = 0; s < (def.spareNeeded || 0); s++) {
          ctx.fillStyle = s < B.spareCount ? "#29e05f" : "rgba(255,255,255,.28)";
          ctx.font = FONT(12, 700);
          ctx.fillText("✚", W / 2 + 34 + s * 12, 99);
        }

        // ミケの囁き(画面右端に縦書きで常時)
        ctx.textAlign = "center"; ctx.font = FONT(9);
        const wsp = def.whispers[B.whisperIdx];
        for (let c = 0; c < wsp.length; c++) {
          ctx.fillStyle = c === 0 ? "#29e05f" : "rgba(255,45,149,.85)";
          ctx.fillText(wsp[c], W - 10, 12 + c * 11);
        }
        // ミケの立ち絵(左下ちいさく)
        Assets.draw(ctx, "monsters/mike", 4, 78, 24, 24, { world: "other", label: "ミケ" });

        // 弾幕ボード/攻撃バー(同じ枠)
        ctx.strokeStyle = "#f2f2f2"; ctx.lineWidth = 2;
        ctx.strokeRect(BX - 0.5, BY - 0.5, BW + 1, BH + 1);

        if (B.phase === "bar" || B.phase === "barResult") {
          drawAttackBar(ctx);
        } else if (B.phase === "enemy") {
          drawBullets(ctx);
          if (!(B.invuln > 0 && Math.floor(B.animT * 12) % 2 === 0))
            drawHeart(ctx, B.px, B.py, 4.5, "#ff2d2d");
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

        // 下部:コマンド or 戦闘ログ風テキスト
        if (B.phase === "menu") {
          const cmds = [{ t: "たたかう", warn: false }, { t: "みのがす", warn: false }];
          cmds.forEach((c, i) => {
            const x = 44 + i * 120, y = H - 22;
            ctx.fillStyle = i === B.menuSel ? "#2a0b3d" : "rgba(0,0,0,.35)";
            ctx.fillRect(x, y, 108, 16);
            ctx.strokeStyle = i === B.menuSel ? "#29e05f" : "#777";
            ctx.strokeRect(x + 0.5, y + 0.5, 107, 15);
            if (i === B.menuSel) drawHeart(ctx, x + 10, y + 8, 3.4, "#ff2d2d");
            ctx.fillStyle = i === B.menuSel ? "#fff" : "#bbb";
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
        ctx.restore();

        // 攻撃バー結果のトースト風(バー上部)
        if (B.phase === "barResult" && B.barResult) {
          ctx.fillStyle = B.barResult.indexOf("クリ") === 0 ? "#29e05f" : B.barResult === "ミス!" ? "#ff2d2d" : "#ffd23f";
          ctx.font = FONT(11, 700); ctx.textAlign = "center";
          ctx.fillText(B.barResult, W / 2, BY - 16);
        }
        Dialogue.draw(ctx);
      },
    };
    function startEnemyTurn() {
      B.phase = "enemy"; B.turnT = 0; B.bullets = [];
      B.px = BX + BW / 2; B.py = BY + BH / 2;
    }
    function drawAttackBar(ctx) {
      const bx = BX + 10, by = BY + 30, bw = BW - 20, bh = 26;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(bx, by, bw, bh);
      // ゾーン:中央=緑(大)、外=黄(通常)、端=赤(空振り)
      ctx.fillStyle = "rgba(255,45,45,.5)"; ctx.fillRect(bx, by, bw * 0.30, bh); ctx.fillRect(bx + bw * 0.70, by, bw * 0.30, bh);
      ctx.fillStyle = "rgba(255,210,63,.55)"; ctx.fillRect(bx + bw * 0.30, by, bw * 0.40, bh);
      ctx.fillStyle = "rgba(41,224,95,.8)"; ctx.fillRect(bx + bw * 0.445, by, bw * 0.11, bh);
      // 白い線(往復)
      const p = B.barLocked >= 0 ? B.barLocked : B.barPos;
      ctx.fillStyle = "#fff"; ctx.fillRect(bx + p * bw - 1, by - 4, 2, bh + 8);
      ctx.strokeStyle = "#f2f2f2"; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = "#eee"; ctx.font = FONT(9); ctx.textAlign = "center";
      ctx.fillText(B.barLocked >= 0 ? "" : "Zで、止めろ", bx + bw / 2, by - 16);
    }
    return scene;
  }

  /* ---------------- バッドエンドシーン(§8:短いテキスト→ヒント→タイトル) ---------------- */
  function makeBadEnd(data) {
    const key = data.key;
    const bd = G.STORY.badEnds[key] || { title: "バッドエンド", text: ["……"], hint: "" };
    let i = 0;
    const pages = [{ n: "", t: bd.title }].concat(bd.text.map((t) => ({ n: "", t })));
    if (bd.hint) pages.push({ n: "", t: "―― ヒント ――" }, { n: "", t: "「" + bd.hint + "」" });
    pages.push({ n: "", t: "タイトルにもどる。直前の関門から、やり直せる(関門実装はステージ4)。" });
    return {
      init() { G.transition(null, "fade"); },
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
  G.ENEMIES = ENEMIES; // ステージ3〜5で拡張(ハニークイーン/門番/魔女)
})();
