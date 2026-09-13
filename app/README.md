# Swat or Buy, the show

A static web app in which a fruit fly's eye judges two ads. The retina and lamina of the
MaleCNS v1.0 connectome run in the visitor's browser, in a Web Worker, at the same 0.1 ms
timestep as the Python model. No backend, so it deploys to Vercel as plain files.

## What happens on the page

Screenshots of every step are in the [root README](../README.md#how-the-show-works-in-pictures).

1. **Landing.** A hero on the fly's grey screen ("Two ads. One fly. Swat or Buy.") and two
   empty contestant slots, A and B. Drop, pick or paste an image or short video into each,
   or press **Browse the sample ads**: a gallery of 13 real public-domain ads (1891 to 1921,
   from Wikimedia Commons) and 10 modern mock ads for fictional brands. Tick two for a duel
   or up to eight for a bracket, or press **Surprise me**. The line-up is `public/samples/`
   plus `index.json`; credits are in `../THIRD_PARTY.md`. The eye on the right is already
   alive; the screen stays blank until there is something to look at.
2. **Looking.** Click a thumbnail to show that ad to the fly, drag to move it, scroll to
   resize. The glance map paints the lamina columns that stand out from the rest of the
   field, smoothed over time. **Fly vision** redraws the screen as the photoreceptors sample
   it: one dot per cell, R1–R6 in grey with no red channel, R8 cells in blue or green.
3. **Human vs fly.** Press **Start** and, before the fly sees anything, you are asked which
   ad you would buy (or who takes the bracket). The result says whether the fly agreed, and
   the device keeps a running count in `localStorage`. Skip is always available.
4. **The show.** The lights go down. A round tracker in the header walks through Warm-up,
   Contestant A, Contestant B, Face-off and Verdict; each round opens with a banner. Per
   contestant: one second of the ad, one second of its pixels shuffled, one second of a
   flat grey of the same brightness, and one second of the ad at half size inside a busy
   mock feed tiled with blocks of every contestant's pixels. Then the face-off with one ad
   per eye in both orders. The fly's commentary appears as a subtitle on the stage and is
   logged on the right; the scoreboard's tug-of-war bars fill in as each number lands.
5. **Bracket.** With three to eight contestants the same protocol runs match by match
   (byes advance). Early matches get stamps only and move straight on; the bracket tree on
   the right shows who advanced. The final gets the full verdict.
6. **Verdict.** Ads are ranked by the layout-driven part of the lamina's response (glance
   minus shuffled), with side-by-side share, feed pull and hold as tie-breaks. The winner
   gets a BUY stamp and confetti, the loser gets the swatter, and a result card offers
   **Run it again**, **Save the card** (a 1200×630 PNG of the face-off with the stamps, the
   scores and the human-vs-fly line) or **New contestants**.

Every sentence the fly says is a measurement that just happened; the first-person voice is
a convenience, not cognition. Speed, pause and reset live behind the ⚙ button so the
default view stays calm. `?src=a.png&src=b.png&judge` preloads ads and starts the show;
`&judge=skip` skips the human pick, for demos and shared links.

## What the fly is given

R1–R6 receive the screen weighted by the Rh1 pigment's sensitivity, roughly 3 % red, 42 %
green, 55 % blue (`src/neural/spectral.ts`), normalised to sum to one so greyscale stimuli
drive the eye exactly as under human luminance and the reference-rate test still holds.
R8p cells read the blue primary and R8y the green, as before. Red on screen is therefore
nearly dark to this eye. The Python full-brain model still uses human luminance for R1–R6;
the two disagree only on coloured stimuli.

The model has no adaptation: a second viewing of an ad produces the same lamina response as
the first, and a four-second exposure is flat from start to finish. That is why there is no
"ad fatigue" round; the fly's `hold` metric measures the little within-second settling the
circuit does have.

## Code

- `src/neural/EyeBrain.ts`: the kernel, a dense-step port of the Python simulator, validated
  against full-brain reference rates by `src/neural/EyeBrain.test.ts`. `src/neural/spectral.ts`
  holds the receptor weighting.
- `src/neural/eye.worker.ts`: look mode (frames in, activity out) and judge mode (the
  protocol, paced by `judge-continue` messages from the page).
- `src/judge/measure.ts`: metrics from spike counts, pixel shuffle, flat grey, feed and
  side-by-side composition. `src/judge/narrator.ts`: measurements to sentences and the
  verdict rule. `src/judge/card.ts`: the shareable verdict PNG.
- `src/render/ScreenView.ts`: the fly's screen, glance map, crosshair and fly vision.
  `src/render/EyeRenderer.ts`: both eyes as point clouds coloured by change since grey.
- `src/main.ts`: the page, line-up, human pick, bracket, show, stamps and confetti.
  `src/theme/palette.ts`: colours.
- `public/data/eye-circuit.json`: 29,195 neurons and 592,137 connections cut by
  `../scripts/extract_eye_circuit.py` (2 MB gzipped).

## Run

```sh
npm ci
npm run dev          # http://127.0.0.1:5173
npm test             # kernel validation against the Python reference
npm run bench        # kernel speed at each timestep
npm run build        # dist/
node scripts/shot.mjs "http://127.0.0.1:5173/?src=/samples/ad-quiet.png&src=/samples/ad-loud.png&judge" shot.png 40000
```

## Deploy

Vercel: import the repository, set the project root directory to `app`, framework Vite,
build `npm run build`, output `dist`. Any static host works.

## Regenerate the data

From the repository root, with the MaleCNS data prepared (`swat prepare`):

```sh
.venv/bin/python scripts/extract_eye_circuit.py
.venv/bin/python scripts/export_reference_rates.py
```

## Design

Two cards: an off-white studio card that goes dark when the show starts, and a near-black
violet eye card with live meters, the bracket, a scoreboard and the commentary. Colours are
the Multiply brand palette: violet `#9747FF` as the primary and action colour, yellow for
BUY, orange for SWAT, pink for the fly thinking, near-black ink on off-white paper.
Contestants get eight colours of their own; neural roles are coral receptors, aqua lamina,
yellow feedback. Type is Bricolage Grotesque for display, DM Sans for text and JetBrains
Mono for figures. Buttons have a pressed hard shadow in the spirit of
[Swat](https://github.com/hrook1/Swat) by hrook1. Live numbers are smoothed and redrawn a
few times a second so they read as dials, not noise. The code is ours.
