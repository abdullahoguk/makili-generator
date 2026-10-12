#!/usr/bin/env python3
"""
Ustanın afişini hücre grid'ine çevirir — kuralları tahminle değil ölçümle koymak için.

    python3 tools/extract-reference.py

Girdi : sources/hakbir normal.png
Çıktı : src/data/reference.json

Afişten ölçülenler:
  - hücre kenarı, bant yüksekliği, satır arası
  - her satırın hücre matrisi
  - bloklar (tamamen boş sütunlarla ayrılmış parçalar)
  - blok başına harf sayısı -> kaç kaynaşma var
"""

import json
import sys
from collections import deque

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("PIL ve numpy gerekli:  pip install pillow numpy")

SRC = "sources/hakbir normal.png"
OUT = "src/data/reference.json"

# Afişte yazılan dizeler. Blok sayısıyla karşılaştırıp kaynaşmaları sayıyoruz.
LINES = [
    "hakbirgönülverdibana",
    "hademeyenhayranolur",
    "birdemgelirşadolur",
    "birdemgelirgiryanolur",
]

INK_THRESHOLD = 110  # koyu zemin, açık mürekkep
BAND_HEIGHT = 9      # glif bandı, hücre


def bands(ink):
    """Yatay projeksiyondan satır bantlarını bulur."""
    proj = ink.sum(axis=1) > 0
    out, start = [], None
    for i, v in enumerate(proj):
        if v and start is None:
            start = i
        if not v and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(proj) - 1))
    return out


def to_grid(ink, top, bottom, left, right, width):
    """Bir bandı hücre matrisine indirger; her hücrenin orta %40'ına bakar."""
    cell_y = (bottom - top + 1) / BAND_HEIGHT
    cell_x = (right - left + 1) / width
    rows = []
    for r in range(BAND_HEIGHT):
        y0 = int(top + r * cell_y + cell_y * 0.3)
        y1 = int(top + r * cell_y + cell_y * 0.7)
        row = ""
        for c in range(width):
            x0 = int(left + c * cell_x + cell_x * 0.3)
            x1 = int(left + c * cell_x + cell_x * 0.7)
            row += "#" if ink[y0 : y1 + 1, x0 : x1 + 1].mean() > 0.5 else "."
        rows.append(row)
    return rows


def split_blocks(rows):
    """Tamamen boş sütunlar ayırıcıdır; aradaki dolu parçalar bloktur."""
    h, w = len(rows), len(rows[0])
    empty = {x for x in range(w) if all(rows[y][x] == "." for y in range(h))}
    out, start = [], None
    for x in range(w + 1):
        full = x < w and x not in empty
        if full and start is None:
            start = x
        if not full and start is not None:
            out.append((start, x - 1))
            start = None
    return out, sorted(empty)


def pockets(rows, x0, x1):
    """Blok içindeki boş cepler — kenar komşuluğuna göre."""
    h = len(rows)
    w = x1 - x0 + 1
    sub = [[rows[y][x] == "#" for x in range(x0, x1 + 1)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    out = []
    for y in range(h):
        for x in range(w):
            if sub[y][x] or seen[y][x]:
                continue
            q, comp = deque([(x, y)]), []
            seen[y][x] = True
            while q:
                cx, cy = q.popleft()
                comp.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not sub[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            xs = [p[0] for p in comp]
            ys = [p[1] for p in comp]
            out.append(
                {
                    "area": len(comp),
                    "w": max(xs) - min(xs) + 1,
                    "h": max(ys) - min(ys) + 1,
                    "x": min(xs),
                    "y": min(ys),
                    # kenara açık cep: blok sınırından dışarı bakıyor
                    "openLeft": min(xs) == 0,
                    "openRight": max(xs) == w - 1,
                    "openTop": min(ys) == 0,
                    "openBottom": max(ys) == h - 1,
                }
            )
    return out


def main():
    im = Image.open(SRC).convert("RGB")
    ink = np.array(im).mean(axis=2) > INK_THRESHOLD

    all_bands = bands(ink)
    text_bands = [b for b in all_bands if (b[1] - b[0] + 1) > 200][: len(LINES)]
    if len(text_bands) != len(LINES):
        sys.exit(f"beklenen {len(LINES)} bant, bulunan {len(text_bands)}")

    cols = np.where(ink[text_bands[0][0] : text_bands[0][1] + 1].any(axis=0))[0]
    left, right = int(cols.min()), int(cols.max())

    heights = [b[1] - b[0] + 1 for b in text_bands]
    cell = sum(heights) / len(heights) / BAND_HEIGHT
    width = round((right - left + 1) / cell)
    line_gaps = [text_bands[i + 1][0] - text_bands[i][1] - 1 for i in range(len(text_bands) - 1)]

    lines, fused_total = [], 0
    for (top, bottom), text in zip(text_bands, LINES):
        rows = to_grid(ink, top, bottom, left, right, width)
        blocks, empty_cols = split_blocks(rows)
        fused = len(text) - len(blocks)
        fused_total += fused
        lines.append(
            {
                "text": text,
                "rows": rows,
                "letters": len(text),
                "blocks": [
                    {
                        "x": x0,
                        "w": x1 - x0 + 1,
                        "art": [rows[y][x0 : x1 + 1] for y in range(BAND_HEIGHT)],
                        "pockets": pockets(rows, x0, x1),
                    }
                    for x0, x1 in blocks
                ],
                "emptyColumns": empty_cols,
                "fusions": fused,
            }
        )

    # Boş sütun koşuları: hepsi 1 olmalı, yani harf arası tam bir hücre.
    gap_widths = set()
    for line in lines:
        cols_ = line["emptyColumns"]
        run = 1
        for i in range(1, len(cols_) + 1):
            if i < len(cols_) and cols_[i] == cols_[i - 1] + 1:
                run += 1
            else:
                gap_widths.add(run)
                run = 1

    data = {
        "source": SRC,
        "note": "Üretilmiş dosya — tools/extract-reference.py",
        "metrics": {
            "cellPx": round(cell, 2),
            "bandHeight": BAND_HEIGHT,
            "lineGapCells": round(sum(line_gaps) / len(line_gaps) / cell),
            "lineWidthCells": width,
            "letterGapCells": sorted(gap_widths),
        },
        "lines": lines,
        "fusionsTotal": fused_total,
    }
    json.dump(data, open(OUT, "w"), ensure_ascii=False, indent=1)

    print(f"hücre         : {cell:.2f} px")
    print(f"satır genişliği: {width} hücre (dördü de aynı: "
          f"{all(len(l['rows'][0]) == width for l in lines)})")
    print(f"satır arası    : {data['metrics']['lineGapCells']} hücre")
    print(f"harf arası     : {sorted(gap_widths)} hücre  <- hepsi 1 ise kelime boşluğu yok")
    print(f"kaynaşma       : {fused_total} (satır başına "
          f"{[l['fusions'] for l in lines]})")
    print(f"\nyazıldı: {OUT}")


if __name__ == "__main__":
    main()
