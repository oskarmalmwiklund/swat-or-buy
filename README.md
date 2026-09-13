# swat-or-buy

Ad creative, judged by a simulated fruit fly brain. Pipes your creative into the MaleCNS v1.0
connectome's optic lobes and scores it on pre-attentive salience: 166,700 neurons, zero
opinions about your positioning.

Upload one ad and see what the fly's optic lobe makes of it. Upload two and they are shown side
by side, once in each screen order. Stills or video up to five seconds. The fly cannot read.

## What it is

- The whole male fruit fly central nervous system (MaleCNS v1.0, released 3 Sep 2026 by
  HHMI Janelia, Cambridge and Google Research) simulated as leaky integrate-and-fire cells
  at 0.1 ms. The simulator, retinal mapping and mushroom body readout are copied from
  [Bananflugakompassen](https://github.com/Fluffet/bananflugakompassen) /
  [Stonkfly](https://github.com/nftechie/stonkfly) (MIT); see `THIRD_PARTY.md`.
- 3,377 R1-R6 photoreceptors see luminance and 811 R8 cells see blue or green, sampled from
  a 320×180 screen. The left eye sees the left 60 % of the screen, the right eye the right 60 %.
- An ad is shown for one second (stills) or in real time (video) after half a second of grey.
  Every number is stimulus minus grey baseline, over several jittered trials, with a bootstrap
  interval.
- Every ad is also shown as six **null controls**: pixel scramble, phase scramble, blur,
  greyscale, luminance-matched flat grey, and mirror. If the ad does not differ from its own
  scramble, the fly is measuring brightness and the report says so.
- **Readouts** are named populations: `glance` (lamina L1/L2/L3 contrast response), `boredom`
  (habituation over the exposure), `swat` (looming and escape cells LC4, LPLC2, LC6, LC16,
  DNp02, DNp11), `buy` (approach minus avoidance mushroom body output neurons, Aso et al.
  2014), `gaze` (small-object cells LC10, LC11, LC18), `motion` (T4/T5), `turn` (DNa02 left
  minus right), `vpn` (everything leaving the optic lobe).
- The **fly map** overlays where the optic lobe changed most, drawn at each column's screen
  position, next to a classical pixel saliency map for comparison.

## What the model gate says

Real flies have known answers to a few stimuli. Before trusting a readout we show the same
stimuli to the model (`swat gate`). In the current build:

| Check | Result |
|---|---|
| Lamina sees contrast (disc vs grey) | pass |
| Looming disc drives LC4 / LPLC2 | fail: 0 Hz |
| Drifting grating gives direction-selective T4 / T5 | fail: 0 Hz |
| Small moving dot drives LC11 / LC18 | fail: 0 Hz |
| Projection neurons separate a disc from its scramble | fail |
| Valence separates a disc from its scramble | fail |

The image reaches the photoreceptors and the lamina and stops there. The medulla, T4/T5, the
lobula columnar cells and everything downstream are silent under every stimulus tried. The
reason is structural: the fly optic lobe up to T4/T5 is a graded-potential system that
works by disinhibition, and an integrate-and-fire cell with no resting drive cannot be
disinhibited into firing. Adding a uniform tonic bias makes those cells fire but gives no
stimulus discrimination (see `PLAN.md`).

So today the honest readouts are `glance`, `boredom` and the fly map. The deep readouts
(`swat`, `buy`, `gaze`, `motion`, `turn`, `vpn`) are computed and shown greyed out, and the
mushroom body `buy` score responds to overall brightness and left/right balance, not layout.
Making the deep readouts see structure is the open phase 0 problem; the most promising route
is to use [flyvis](https://github.com/TuragaLab/flyvis) as a graded optic-lobe front-end
and inject its outputs into the matching MaleCNS cells.

## The live eye, in the browser

`app/` is a static web app that runs the eye circuit itself (retina, lamina and the Dm cells
that feed back onto it: 29,195 neurons, 592,137 connections) in a Web Worker in the visitor's
browser, at the same 0.1 ms timestep as the Python model. Two to eight ads go in the line-up,
the visitor calls the winner first, then the fly looks at each ad, at its shuffle, at a flat
grey, at the ad inside a busy mock feed, and at pairs side by side, narrates what its first
synapse measured, and stamps one BUY and swats the rest (a bracket, if there are more than
two). A **fly vision** toggle shows the screen as the photoreceptors sample it, with no red
channel, and the verdict exports as a shareable PNG. It needs no server and deploys to Vercel
as static files. See `app/README.md`. One difference from the Python model: the browser's
R1-R6 weight the screen's primaries by the fly's Rh1 sensitivity (about 3 % red, 42 % green,
55 % blue) instead of human luminance. The Python service below remains the full-brain,
null-controlled report.

## Run it locally

Python 3.11+, a C++ compiler, about 16 GB RAM to build the graph and 4 GB to run it.

```sh
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/swat prepare     # downloads 1.1 GB from Janelia into data/, compiles the graph (~7 min)
.venv/bin/swat gate        # reference-stimulus gate, cached in data/gate.json (~40 s)
.venv/bin/swat score examples/ad-quiet.png examples/ad-loud.png
.venv/bin/swat score examples/ad-loom.mp4 --max-seconds 2
.venv/bin/swat tournament examples/ --trials 3
```

`swat score` writes `results/<timestamp>/index.html`, a self-contained report, plus
`result.json` and PNGs. One still ad with all controls and five trials takes about 90 s on an
M4 Pro; a two-second video about the same.

## Host it

```sh
.venv/bin/swat serve --port 8000        # or: docker compose up
```

One worker thread owns the brain and works through a queue; uploads are limited to two files,
40 MB each, five seconds of video and ten trials (`SWAT_MAX_SECONDS`, `SWAT_MAX_TRIALS`).
Results persist under `SWAT_RESULTS` (default `results/`) and each job gets a permalink at
`/results/<job>/index.html`. The Docker image downloads the data into the `/data` volume on
first start; give the container 6 GB.

API: `POST /api/jobs` (multipart `files`, `trials`, `max_seconds`) returns a job;
`GET /api/jobs/{id}` polls it; `GET /api/status` and `GET /api/gate` describe the model.

## Layout

```
swatorbuy/fly/        simulator, connectome import, retinal mapping (upstream, MIT)
swatorbuy/stimuli.py  screen fitting, video decoding, null controls, reference stimuli, side by side
swatorbuy/readouts.py populations, recorder, readout registry, salience map
swatorbuy/protocols.py solo, pair, tournament
swatorbuy/baselines.py pixel statistics and spectral-residual saliency the fly must beat
swatorbuy/gate.py     reference-stimulus gate
swatorbuy/report.py   JSON, PNGs, self-contained HTML
swatorbuy/service.py  FastAPI hosted experiment
swatorbuy/web/        front-end (also embedded in static reports)
tests/                unit tests; tests/test_fly.py needs the prepared data
```

## Caveats

Every score is a readout of an engineered model, not fly behaviour. Synaptic weights are
synapse counts times a transmitter sign times 0.275 mV, transmitter signs come from a
classifier, graded cells are simulated as spiking cells, there are no gap junctions, receptor
types or neuromodulation, and it is a male brain. The simulator is deterministic: the same ad
gives the same answer forever, and the jitter interval is trial noise we add, not biology.
Ads you test must be ones you have the right to run.
