# Printing

How Foldoku turns a puzzle into a two-sided PDF whose front and back line up, and how a
player can calibrate their printer. The player-facing instructions (in Russian) live in
the page itself, under «Как распечатать, чтобы стороны совпали» in `src/web/body.html`.

## 1. What the PDF contains

| page | content |
|------|---------|
| 1 | front of the sheet: 8×8 cells of 22 mm (176 mm square), bleed, crop marks, title, a one-line rule |
| 2 | back of the sheet, laid out to sit exactly behind page 1 |
| 3 | optional answer page: every step as a diagram with its instruction, then both faces of the result |

The calibration file has two pages: a target on the front and a millimetre grid behind it.

Paper is A4 or US Letter, portrait. The 22 mm cell gives an 88 mm square when folded, close
to the original cards, and leaves at least 17 mm of margin on both papers, which is more
than any printer's non-printable border.

## 2. Registration

Duplex printing turns the paper over one edge. What lies behind a point (x, y) of page 1
(in mm, origin top-left, y down, page W×H) is:

| flip | point on page 2 |
|------|-----------------|
| long edge | (W − x, y) |
| short edge | (x, H − y) |

The back is drawn in the **back frame**: page 1 mirrored left to right, so column `x` of
the back frame shows cell column `7 − x` (the same mirroring as the on-screen back,
`paintAt` in `src/web/render.ts`). The sheet is centred horizontally, so the mirror keeps it
in place. `backMatrix` maps the back frame to page 2:

```
long:  p ↦ p + u
short: p ↦ R(p + u),  R = half turn about the page centre: (x, y) ↦ (W − x, H − y)
```

where `u = (dx, dy)` is the calibration offset, measured in the back frame (right and down
as seen on the back). The whole back page, labels included, goes through one `cm`
operator, so nothing can drift apart. `test/print.test.ts` checks every cell centre
against the table above for both papers and both flips.

## 3. Calibration

Printers shift the back by 0.5–2 mm, sometimes more, and the shift stays the same from
sheet to sheet. Let `e` be that error in the back frame. The front target sits at the sheet
centre `c`; the back frame puts its mirror image at the same point. A pin pushed through the
front target pierces the back at `c`. The grid around the back's centre is printed at
`c + u + e`, so the pin reads

```
r = c − (c + u + e) = −u − e
```

on the grid. The offset that cancels the error is `u' = −e = u + r`: **add the reading to
the current offset**. A second calibration print with `u'` should read 0. The calibration
pages always print with the current offset, so the procedure can be repeated to refine it.

The grid spans ±6 mm with 1 mm lines and 0.5 mm sub-lines. A reading off the grid almost
always means the wrong flip edge or scaling other than 100 %.

## 4. Bleed and what misregistration still does

- **Edges.** Each border cell's outer quarter is extended 2.5 mm past the sheet edge, and
  the crop marks sit outside that. Cutting on the front's marks leaves colour on the back's
  edge even when it is shifted by up to 2.5 mm.
- **Inside the sheet.** Boundaries between cells cannot bleed, because neighbouring cells
  have different paint. An uncorrected shift shows up as a thin strip of a neighbour's
  colour along the folds of the finished square. Calibration is the fix.
- **Scaling and skew** are not corrected. Most printers have neither once scaling is 100 %.

## 5. The PDF writer

`src/web/pdf.ts` is a ~180-line writer with no dependencies. It supports:

- vector paths: rectangles, polygons, lines and circles;
- dashes, round caps and opacity through `ExtGState`;
- Helvetica text: one of the 14 standard fonts, so nothing is embedded; ASCII only;
- greyscale and RGB images;
- Flate compression via `CompressionStream`, which browsers and Node 18+ provide.

Pages are drawn in millimetres with y down: each page starts with a `cm` that scales by
72/25.4 and flips the y axis, so layouts read like the SVG code.

The standard fonts have no Cyrillic. Russian labels are therefore rendered by the browser
into a canvas at 12 px/mm (about 300 dpi), using the page font, and placed as greyscale
images (`src/web/labels.ts`). The layouts in `src/web/print.ts` take that renderer as a
`Labeler` argument, which keeps them pure: the tests pass a stub.

The catalog carries `/ViewerPreferences << /PrintScaling /None /Duplex … >>`. Viewers
that respect it (Acrobat, some others) preselect 100 % and the right duplex mode.

## 6. Limitations and ideas

1. **Text is raster.** Labels and instructions are images: crisp in print, but not
   searchable or selectable. Embedding a subset of an open font (for example Golos Text
   under OFL) would fix this at the cost of a font subsetter.
2. **One puzzle per file.** Booklets and level packs (roadmap 3.3–3.4) need several
   puzzles, a cover and a combined answer key.
3. **No physical proof yet.** Registration is verified in code and in rendered PDFs, not
   on paper (roadmap 3.5). The calibration procedure has not been tried by players.
4. **No crease guides on the diagonals.** Only the grid is printed. Faint diagonal ticks
   at the cell corners could help with diagonal folds without giving the solution away.
5. **Downloads inside a Claude artifact** go through the host's `downloads` capability
   (the viewer confirms each file); the standalone page uses a plain Blob link.
