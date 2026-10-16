#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""assets/tools/build_heroes.py ―― 主人公スプライトの下準備(1回きりの前処理)

元画像(mio_real.png / mio_other.png)は縦に長い1枚絵。ゲーム内部では
1ドット=1画素なので、このままだと細かすぎて潰れる。そこで:

  1. 高さ120pxのまま横幅を比で縮約(NEAREST。輪郭のにじみ無し)
  2. 歩行アニメ用の「帯」に切り出す。境界は髪・袖・裾の**透明行**から自動検出
     (身体を勝手に設計しない。絵が既に切れている場所だけで分ける)

生成物(ランタイムが先に読み、無ければ元の 1枚絵→仮矩形と段階フォールバック):
  assets/characters/mio_real_s.png   縮約版
  assets/characters/mio_other_s.png  縮約版
  assets/characters/mio_parts.json   帯の切り出し位置(縮約版のpx)

使い方: python3 assets/tools/build_heroes.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHAR = os.path.join(ROOT, "assets", "characters")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow が必要: pip install --break-system-packages pillow")

TARGET_H = 120      # 1px=1ドット前提。ゲームでは26〜32px相当に縮めて使う
MIN_OPAQUE = 12     # 未満の alpha は透明扱い(帯の境探し)


def alpha_counts(img):
    a = img.split()[3]
    w, h = img.size
    px = a.load()
    return [sum(1 for x in range(w) if px[x, y] > MIN_OPAQUE) for y in range(h)]


def find_gap(rows, lo, hi):
    """[lo,hi) で不透明ピクセルが最も少ない行 = 自明な切れ目。"""
    lo, hi = max(0, lo), min(len(rows), hi)
    best, best_n = lo, 10 ** 9
    for y in range(lo, max(lo + 1, hi)):
        if rows[y] < best_n:
            best, best_n = y, rows[y]
    return best


def process(key):
    src = os.path.join(CHAR, f"{key}.png")
    if not os.path.exists(src):
        print(f"[skip] {src} 無し(ランタイムは元画像→仮矩形で動く)")
        return None
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    scale = TARGET_H / h
    tw = max(1, int(round(w * scale)))
    small = im.resize((tw, TARGET_H), Image.NEAREST)
    small.save(os.path.join(CHAR, f"{key}_s.png"))
    print(f"[ok] characters/{key}_s.png {small.size}")

    rows = alpha_counts(small)
    H = TARGET_H
    y_neck = find_gap(rows, int(H * 0.26), int(H * 0.46))   # 髪の下 / 肩の上
    y_hem = find_gap(rows, int(H * 0.66), int(H * 0.86))    # 衣の裾
    return {"w": tw, "h": H, "bands": [y_neck, y_hem]}


def main():
    meta = {}
    for key in ("mio_real", "mio_other"):
        p = process(key)
        if p:
            meta[key] = p
    if meta:
        with open(os.path.join(CHAR, "mio_parts.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        print("[ok] characters/mio_parts.json")


if __name__ == "__main__":
    main()
