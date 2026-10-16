/* ============================================================
 * 「いろ」 maps.js ―― 病棟のマップデータ
 * ・1マップ=1画面(20x15タイル、1タイル16px=320x240)。廊下だけ横長(40x15)でカメラ追従。
 * ・部屋同士は直接つながない。すべて廊下(ハブ)のドア経由。
 * ・タイル記号:  # 壁(通行不可)  w 壁の窓  . 床  F 家具(通行不可)
 *              D 出入口(踏むと暗転転送)  G 芝生  P 通路  T 机(着席不可・通行不可)
 * ============================================================ */
window.IRO_MAPS = (function () {
  "use strict";
  const RW = 20, RH = 15; // 1画面サイズ(タイル)

  function base(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let line = "";
      for (let x = 0; x < w; x++) {
        line += (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? "#" : ".";
      }
      rows.push(line);
    }
    rows.w = w; rows.h = h;
    return rows;
  }
  function set(rows, x, y, ch) { if (rows[y]) rows[y] = rows[y].substr(0, x) + ch + rows[y].substr(x + 1); }
  function fill(rows, x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(rows, x, y, ch); }
  function block(rows, x0, y0, w, h, ch) { fill(rows, x0, y0, x0 + w - 1, y0 + h - 1, ch || "F"); }

  const maps = {};

  /* ---------------- 廊下（ハブ） 40x15 ---------------- */
  (function () {
    const w = 40, h = RH, rows = [];
    function putc(s, i, c) { return s.substr(0, i) + c + s.substr(i + 1); }
    // 通路: y=6..8 / 北壁: y=5 / 南壁: y=9 / 上下は装飾壁
    for (let y = 0; y < h; y++) rows.push(y >= 6 && y <= 8 ? ".".repeat(w) : "#".repeat(w));
    // 北壁に窓と出入口（上側: 病室・談話室・ステーション・屋上扉・食堂）
    for (let x = 2; x < w; x += 4) rows[5] = putc(rows[5], x, "w");
    [[4, "room"], [12, "lounge"], [20, "station"], [32, "canteen"]].forEach(([x]) => {
      rows[5] = putc(rows[5], x, "D");
    });
    rows[5] = putc(rows[5], 26, "F"); // 屋上の扉: 施錠(家具扱い・調べるだけ)
    // 南壁に窓と出入口（下側: 中庭・面会室）
    for (let x = 1; x < w; x += 5) rows[9] = putc(rows[9], x, "w");
    [[8, "courtyard"], [16, "visiting"]].forEach(([x]) => {
      rows[9] = putc(rows[9], x, "D");
    });

    maps.hall = {
      id: "hall", name: "廊下", w, h, rows,
      spawn: { x: 6, y: 7 },
      doors: [
        { x: 4, y: 5, to: "room", tx: 10, ty: 12 },
        { x: 12, y: 5, to: "lounge", tx: 10, ty: 12 },
        { x: 20, y: 5, to: "station", tx: 10, ty: 12 },
        { x: 32, y: 5, to: "canteen", tx: 10, ty: 12 },
        { x: 8, y: 9, to: "courtyard", tx: 10, ty: 2 },
        { x: 16, y: 9, to: "visiting", tx: 10, ty: 2 },
      ],
      objects: [
        { x: 26, y: 5, w: 1, h: 1, kind: "roofdoor", name: "屋上の扉", look: "屋上の扉" },
        { x: 9, y: 6, w: 2, h: 1, kind: "bench", name: "ベンチ", solid: false },
        { x: 24, y: 8, w: 2, h: 1, kind: "board", name: "掲示板" },
        { x: 36, y: 6, w: 2, h: 1, kind: "sink", name: "手洗い場" },
      ],
      npcs: [
        { x: 30, y: 7, sprite: "nurse_night", name: "夜勤の看護師" },
      ],
    };
  })();

  /* ---------------- 自分の病室 ---------------- */
  (function () {
    const rows = base(RW, RH);
    set(rows, 10, 14, "D");
    block(rows, 2, 2, 3, 2, "F");   // ベッド
    set(rows, 6, 2, "F");            // 床頭台
    set(rows, 2, 5, "F");            // 点滴スタンド
    fill(rows, 15, 0, 17, 0, "w");   // 窓(壁側)
    maps.room = {
      id: "room", name: "自分の病室", w: RW, h: RH, rows,
      spawn: { x: 10, y: 12 },
      doors: [{ x: 10, y: 14, to: "hall", tx: 4, ty: 6 }],
      objects: [
        { x: 2, y: 2, w: 3, h: 2, kind: "bed", name: "ベッド", look: "ベッド" },
        { x: 6, y: 2, w: 1, h: 1, kind: "cabinet", name: "床頭台", look: "床頭台" },
        { x: 2, y: 5, w: 1, h: 1, kind: "iv", name: "点滴スタンド", look: "点滴" },
        { x: 9, y: 3, w: 1, h: 1, kind: "call", name: "ナースコール", look: "ナースコール", solid: false },
        { x: 16, y: 1, w: 2, h: 1, kind: "window", name: "窓", look: "窓", solid: false },
      ],
      npcs: [],
    };
  })();

  /* ---------------- 談話室 ---------------- */
  (function () {
    const rows = base(RW, RH);
    set(rows, 10, 14, "D");
    block(rows, 1, 2, 2, 1, "F");    // 棚(封筒)
    block(rows, 5, 9, 3, 1, "F");    // ソファ
    block(rows, 15, 2, 2, 1, "F");   // 本棚
    maps.lounge = {
      id: "lounge", name: "談話室", w: RW, h: RH, rows,
      spawn: { x: 10, y: 12 },
      doors: [{ x: 10, y: 14, to: "hall", tx: 12, ty: 6 }],
      objects: [
        { x: 1, y: 2, w: 2, h: 1, kind: "shelf", name: "棚", look: "棚", keyItem: "letters" },
        { x: 5, y: 9, w: 3, h: 1, kind: "sofa", name: "ソファ" },
        { x: 15, y: 2, w: 2, h: 1, kind: "bookshelf", name: "本棚" },
        { x: 9, y: 3, w: 2, h: 1, kind: "tv", name: "テレビ" },
      ],
      npcs: [
        { x: 12, y: 8, sprite: "hana", name: "ハナ" },
      ],
    };
  })();

  /* ---------------- ナースステーション ---------------- */
  (function () {
    const rows = base(RW, RH);
    set(rows, 10, 14, "D");
    block(rows, 4, 4, 12, 1, "F");   // カウンター
    block(rows, 16, 2, 2, 1, "F");   // 記録棚
    maps.station = {
      id: "station", name: "ナースステーション", w: RW, h: RH, rows,
      spawn: { x: 10, y: 12 },
      doors: [{ x: 10, y: 14, to: "hall", tx: 20, ty: 6 }],
      objects: [
        { x: 4, y: 4, w: 12, h: 1, kind: "counter", name: "カウンター" },
        { x: 16, y: 2, w: 2, h: 1, kind: "board", name: "記録ボード" },
        { x: 6, y: 6, w: 1, h: 1, kind: "callmonitor", name: "ナースコール受信機" },
        { x: 2, y: 2, w: 1, h: 1, kind: "clock", name: "時計", look: "時計" },
      ],
      npcs: [
        { x: 7, y: 3, sprite: "kaede", name: "楓" },
        { x: 11, y: 3, sprite: "doctor", name: "医師" },
      ],
    };
  })();

  /* ---------------- 食堂 ---------------- */
  (function () {
    const rows = base(RW, RH);
    set(rows, 10, 14, "D");
    block(rows, 4, 4, 2, 2, "F"); block(rows, 10, 4, 2, 2, "F");
    block(rows, 4, 9, 2, 2, "F"); block(rows, 10, 9, 2, 2, "F");
    block(rows, 15, 2, 3, 1, "F");  // 配膳台
    maps.canteen = {
      id: "canteen", name: "食堂", w: RW, h: RH, rows,
      spawn: { x: 10, y: 12 },
      doors: [{ x: 10, y: 14, to: "hall", tx: 32, ty: 6 }],
      objects: [
        { x: 4, y: 4, w: 2, h: 2, kind: "table", name: "机" },
        { x: 10, y: 4, w: 2, h: 2, kind: "table", name: "机" },
        { x: 15, y: 2, w: 3, h: 1, kind: "counter", name: "配膳台" },
        { x: 17, y: 7, w: 2, h: 2, kind: "vending", name: "自動販売機" },
      ],
      npcs: [
        { x: 14, y: 3, sprite: "staff_meal", name: "看護助手" },
      ],
    };
  })();

  /* ---------------- 中庭 ---------------- */
  (function () {
    const rows = base(RW, RH);
    set(rows, 10, 0, "D");
    fill(rows, 10, 1, 11, 13, "P");          // 通路
    for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) {
      if (rows[y][x] === ".") set(rows, x, y, "G"); // 芝
    }
    block(rows, 6, 5, 2, 1, "F");             // ベンチ
    block(rows, 14, 8, 2, 1, "F");            // ベンチ
    block(rows, 3, 11, 1, 1, "F");            // 植え込み
    block(rows, 16, 3, 1, 1, "F");            // 植え込み
    maps.courtyard = {
      id: "courtyard", name: "中庭", w: RW, h: RH, rows,
      spawn: { x: 10, y: 2 },
      doors: [{ x: 10, y: 0, to: "hall", tx: 8, ty: 8 }],
      objects: [
        { x: 6, y: 5, w: 2, h: 1, kind: "bench", name: "ベンチ" },
        { x: 14, y: 8, w: 2, h: 1, kind: "bench", name: "ベンチ" },
        { x: 3, y: 11, w: 1, h: 1, kind: "plant", name: "植え込み" },
        { x: 16, y: 3, w: 1, h: 1, kind: "plant", name: "植え込み" },
      ],
      npcs: [],
    };
  })();

  /* ---------------- 面会室 ---------------- */
  (function () {
    const rows = base(RW, RH);
    set(rows, 10, 0, "D");
    block(rows, 9, 6, 2, 2, "F");             // 机
    fill(rows, 3, 0, 5, 0, "w");              // 窓(壁側)
    maps.visiting = {
      id: "visiting", name: "面会室", w: RW, h: RH, rows,
      spawn: { x: 10, y: 2 },
      doors: [{ x: 10, y: 0, to: "hall", tx: 16, ty: 8 }],
      objects: [
        { x: 9, y: 6, w: 2, h: 2, kind: "table", name: "机" },
        { x: 4, y: 1, w: 2, h: 1, kind: "window", name: "窓", look: "窓", solid: false },
        { x: 17, y: 3, w: 1, h: 1, kind: "clock", name: "時計", look: "時計" },
      ],
      npcs: [],
    };
  })();

  /* ---------------- 屋上（飾り・入れない。参照専用のデータとして置く） ---------------- */
  (function () {
    const rows = base(RW, RH);
    fill(rows, 8, 1, 11, 3, "P");
    maps.roof = {
      id: "roof", name: "屋上", w: RW, h: RH, rows, locked: true,
      spawn: { x: 10, y: 10 },
      doors: [],
      objects: [
        { x: 9, y: 2, w: 2, h: 2, kind: "carousel", name: "カルーセル", look: "カルーセル" },
      ],
      npcs: [],
    };
  })();

  return maps;
})();
