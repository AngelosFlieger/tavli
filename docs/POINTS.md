# Verified physical point map

The board is Y-up. Negative Z is the top row as rendered, positive Z the bottom. Point centers were checked against the original board generation source and the displayed T/B labels.

| Physical IDs | Rendered names | Order |
| --- | --- | --- |
| 0–11 | T1–T12 | Top left to top right |
| 12–23 | B1–B12 | Bottom left to bottom right |

Red path (relative 24 → 1):
`[0,1,2,3,4,5,6,7,8,9,10,11,23,22,21,20,19,18,17,16,15,14,13,12]`

Ivory path (relative 24 → 1):
`[12,13,14,15,16,17,18,19,20,21,22,23,11,10,9,8,7,6,5,4,3,2,1,0]`

Red starts T1 and finishes B1; home B6–B1. Ivory starts B1 and finishes T1; home T6–T1. Both paths visit all 24 points exactly once and are reversals of each other. Engine movement uses these explicit arrays rather than screen coordinates.

X centers for columns 0–5: `-.139 + (column−2.5)*.035`; columns 6–11: `.139 + (column−8.5)*.035`. Checker outer Z centers are ±.184; triangle outer Z edges are ±.205. The rendering positions are independent of the logical paths.
