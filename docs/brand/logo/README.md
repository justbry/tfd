# Trifold™ logo concepts

Status: concepts, 2026-11-07. None of these is the Trifold logo yet. The final mark waits for the trademark clearance search for TRIFOLD in classes 9, 36 and 42 (`TRADEMARKS.md`; the risks in `docs/business/business-plan.md`). Until a registration issues, use ™, never ®.

Open `index.html` to see every concept in every theme at 512, 64, 32 and 16 px, with favicons, lockups, the animations on cream and on ink, the constructions and the round-1 sketches. The page is self-contained: every SVG is inlined.

## Recommendation

**Concept A, turned corners, in the Paper theme**, with the **fold-once** animation on page load and the **cyclical fold** as the hero animation. Night is its dark-mode pair. If the clearance search finds hexagon or triangle marks crowded in our classes, fall back to concept D.

## The concepts

| | Concept | Rationale |
|---|---|---|
| A | **Turned corners** (lead; Grok's round-2 concept, on our construction) | One sheet, three corners folded in. Each corner of an equilateral triangle folds on a crease parallel to the opposite side, a quarter of the side deep, so every folded tip lands on the circle a quarter the size of the circumcircle: three equal folds, 120° apart, that agree without touching. Ink is the front of the paper and saffron its back, so it reads as folded paper, not a pyramid. Every corner can fold out to complete the triangle and back in without leaving it, so the cyclical fold is honest. |
| B | **Turning fold** (the alternate triangle) | Three lines through the centre, each parallel to a side, cut every side in thirds: nine small triangles, three equal trapezoid flaps turning one way (rotational symmetry, no mirror), shaded light, mid and dark with a thin tuck shadow. Grok's verdict: strangers read a pyramid or a low-poly peak, and a flap folded about a radius cannot land inside the triangle. |
| C | **Z-fold receipt** (round-1 A, redrawn twice) | A receipt folded like an accordion in thirds, seen in perspective. The most literal "receipt folded in three"; close to brochure and map icons. |
| D | **Three columns, one check** (round-1 B, redrawn) | The receipt opened flat into its three columns (books, receipt, Stripe) with one check across all three. The clearest at 16 px; the check is also the most common mark in finance UI. |

Construction of A (`concepts/a-construction.svg`): circumradius R = 40 in a 64 grid, centred at (32, 34.5). A compass at each corner with radius a quarter of the side marks where the creases cross the sides; each crease runs parallel to the opposite side; each tip, reflected in its crease, lands on the circle of radius R/4. The rest state is a hexagon with three folded corners.

## Files

| Path | What |
|---|---|
| `concepts/{a,b,c,d}-symbol.svg`, `-lockup.svg` | Each concept in the Paper theme: symbol and the horizontal lockup |
| `concepts/a-mono.svg`, `b-mono.svg` | One-colour versions (folds drawn as cuts in the page colour) |
| `concepts/a-construction.svg`, `b-construction.svg` | Construction drawings |
| `concepts/round-1/` | The four round-1 sketches, for the record |
| `themes/{concept}-{paper,ledger,night}-{symbol,lockup}.svg` | Every concept in every theme |
| `favicons/{concept}-{theme}-{16,32}.svg`, `a-mono-16.svg` | Favicons drawn for 16 and 32 px |
| `animated/*.svg` | Animations (below) |
| `previews/*.png`, `*.gif` | Rendered previews |
| `index.html` | The gallery |

The wordmark is Fraunces (weight 550, optical size 72, SOFT 50) converted to outlines, so no lockup depends on a font being installed. Fraunces is under the SIL Open Font License 1.1, which allows this.

## Themes and contrast

| Theme | Concept A | Checks (WCAG) |
|---|---|---|
| Paper | Ink sheet `#1E2A44`, saffron corners `#E8A33D`, on cream `#F6F1E7` | Ink on cream 12.7:1; saffron on ink 6.6:1. Saffron meets cream only along the three short crease edges (1.9:1); the ink carries the silhouette |
| Ledger | Ink sheet, ledger-green corners `#6CC49A`, on cream | Green on ink 6.8:1; green meets cream only at the creases (1.9:1) |
| Night | Cream sheet, deep saffron corners `#B9781A`, on ink | Cream on ink 12.7:1; deep saffron on cream 3.2:1 and on ink 3.9:1: every edge passes 3:1 |

The wordmark is ink on cream or cream on ink, 12.7:1, above the 4.5:1 needed for small text. Saffron and the light greens never carry text. For B, the slate facet was lightened to `#6F80A8` after Grok measured the old one at 2.2:1 against ink (now 3.6:1). For D, the check sits on a halo in the page colour, so it never touches a column.

## Animations

All are pure SVG and CSS (no script, no SMIL), loop or play once, and show the static mark under `prefers-reduced-motion: reduce`.

| File | Effect | Size |
|---|---|---|
| `a-fold-cycle-{paper,night}.svg` | **Cyclical fold** (hero): one corner at a time folds out to complete the triangle, holds 0.3 s and folds back in, 1 → 2 → 3 → 1, 7.2 s loop. Fake 3D: `scaleY` about the crease, through an edge-on floor of ±0.15 with a colour crossfade, and the corner's shadow lifts with it. The resolved mark is on screen half of every loop | 2.4 KB |
| `a-fold-once-{paper,night}.svg` | **Fold once**: starts as a whole triangle; the corners fold in one after another, then the shadows settle. 2.2 s, then rests | 2.0 KB |
| `a-fold-glint-{paper,night}.svg` | **Cyclical fold + glint and glass sheen**: a soft light sweep, bent by `feTurbulence` and `feDisplacementMap`, passes once per loop over a faint specular sheen | 3.5 KB |
| `b-turn-cycle-{paper,night}.svg` | Concept B's flaps turn about their hinges in sequence | 2.8 KB |
| `c-glimmer-{paper,night}.svg` | **Glimmer**: light catching the folds of the Z-fold | 1.2 KB |
| `d-unfold-check-{paper,night}.svg` | Brand-native: the receipt unfolds into three columns, then the check is drawn | 1.2 KB |

Previews of the lead: `previews/a-paper-512.png`, `a-themes.png`, `a-construction.png`, `a-fold-cycle-frames.png` (16 frames of one loop), `a-fold-cycle-paper.gif` and `a-fold-cycle-night.gif`.

## How it was made: three rounds with Grok

Grok (grok-4.7, headless, in a scratch folder with no repository access) was the critic and alternate designer.

**Round 1** (four receipt concepts). Grok's scores: Z-fold 6, three columns + check 5, folded T 3, fold-check strip 4. Its main points: a V-cut on every panel turns one sheet into three award ribbons; 2-unit gaps vanish at 16 px (use 0 or at least 4); saffron must stay inside the ink or it melts into cream; the check reads as a verified badge; the T is a crowded monogram that looks like a hammer. It proposed "open thirds" and "three-turn fold" alternatives, and Fraunces at about weight 550 for the wordmark. Adopted: the gap rule, one continuous edge, the halo in the page colour, the weight, dropping the T and the strip.

**Owner's direction.** A triangular or sacred-geometry mark that folds in three dimensions and in a cycle. We drew concept B, the turning fold.

**Round 2.** Grok scored the turning fold 5/10: the geometry is real but the picture is a pyramid, the slate and ink facets fuse at 16 px, and a flap folded about a radius has to leave the triangle, so the motion reads as a flap detaching. On the motion: no landed pose, a hairline edge-on state, a hard colour cut, a tan hole that reads as a stain, and the mark broken 84% of the loop. It proposed **turned corners**: corners folded in on creases parallel to the opposite sides, short of the centre. On the alternates: the Z-fold should drop its teeth for one baseline and chamfers; the check should go. Adopted: turned corners as the lead (credited to Grok, put on the R/4 construction), every motion note (landed poses, holds, the ±0.15 floor, crossfades, an ink footprint, half the loop at rest), the lighter slate, and the Z-fold's baseline and chamfers. Not adopted: deleting the check from D, because the check across all three columns is that concept's idea.

**Round 3** (a check of the new lead). Grok scored turned corners 8/10: "the quarter-side fold is the right mark". At 16 px the hexagon and its three chips hold, though the fold itself drops out; the cut corners carry the paper read, but the first shadow was too small to show. The motion matched its notes ("None on the loop"). Adopted: a deeper tuck shadow (offset 2.5, 3 at 40% black, clipped to the sheet) so a rim shows along each folded corner at 64 px, and a quieter glint. Resemblance risks it named for the search: Google Drive, the universal recycling symbol, Delta's solid triangle (the open pose), the radiation trefoil (weakly), and the Acrobat dog-ear as a category.

## Before anything ships

1. Clearance search for TRIFOLD and for the chosen mark (classes 9, 36, 42), including a design-code search for hexagons and triangles with folded corners. Check against Google Drive, the recycling symbol, Delta and folded-corner document icons.
2. Pick one concept and theme, then replace the placeholder `Mark.svelte` in `apps/trifold-site` and the mark in the brief.
3. Rename and re-export the favicons at their final paths.

Copyright 2026 Trifold. All rights reserved. See `LICENSE`.
