# Swat or Buy: build plan

Ad creative, judged side by side by a simulated fruit fly brain. This document records what
exists today, what a pilot run of the simulator showed, and how to build the experiment out
in phases with a go/no-go gate at each step.

Written 2026-09-13. Benchmarks were run on an Apple M4 Pro with 48 GB RAM.

## 1. Where things stand

**This repo** is a README and nothing else. The README already fixes the framing: pipe
creative into the MaleCNS v1.0 connectome's optic lobes and score it on pre-attentive
salience.

**The connectome.** MaleCNS v1.0 was released 2026-09-03 by HHMI Janelia FlyEM, the
Cambridge Connectomics Group and Google Research. It covers the whole male central nervous
system including both optic lobes and the ventral nerve cord. The flat connectome is three
Arrow/feather files on Google Cloud Storage (annotations 14 MB, neurotransmitter predictions
43 MB, edges 1.05 GB), licensed CC BY 4.0. After filtering to annotated neurons the graph is
166,700 cells and 25.6 million directed edges.

**Bananflugakompassen** (Fluffet, MIT) is a thin wrapper around the simulator from
nftechie's DOOMFLY and Stonkfly. Everything under `neural/` is copied from there. The fork
plan is: take `neural/` and `prepare.py` verbatim with attribution, replace `valkompass.py`
with our own protocol and readout code. There is nothing else in the repo worth keeping
(the screenshots and answer tiles are SVT-specific).

**The wider ecosystem** (see cobanov/awesome-fly) has roughly fifty MaleCNS toy projects
since release. Three are directly relevant:

- **flyvis** (Turaga lab, Nature 2024, MIT). A connectome-constrained, task-trained model of
  the optic lobe's motion pathway: 64 cell types on a 721-column hexagonal retina, graded
  dynamics, validated against calcium imaging of real neurons. This is the only fly vision
  model in the ecosystem with published validation.
- **ommatid** (FutureJJ). Chains flyvis as the optic lobe into the MaleCNS spiking model
  via 892 retinotopic columns, then reads descending neurons for locomotion. Proof that the
  hybrid is doable.
- **FlyScroll** (ranagwho). A MaleCNS "doomscroller" that advances a video feed when a
  novelty signal habituates. Closest existing thing to an engagement metric.

## 2. How the inherited simulator works

- Leaky integrate-and-fire neurons, 0.1 ms timestep, single-threaded C++ kernel with lazy
  exact subthreshold integration (inactive cells are skipped, no edges are dropped).
- Synaptic weight = synapse count × predicted transmitter sign × 0.275 mV. Glutamate, GABA
  and histamine are inhibitory; acetylcholine excitatory; dopamine, octopamine and
  serotonin are routed to a modulatory trace instead of fast excitation.
- Vision: 3,377 R1-R6 photoreceptors receive linear luminance sampled at one pixel each; 811
  R8 cells receive linear sRGB blue (R8p) or green (R8y). Each receptor's screen position is
  inferred from which lamina column it contacts most. The left eye sees screen x 0.0 to 0.6,
  the right eye x 0.4 to 1.0, so a two-up layout maps naturally onto the two eyes.
- Lamina cells L1, L2, L3, L5 get a constant 12 mV bias current so they can be inhibited.
- Readout used by Bananflugakompassen: mean membrane voltage above rest in six approach
  MBONs minus five avoidance MBONs (Aso et al. 2014), minus the same during a grey blank.
- Plasticity (KC to MBON07 and MBON11, dopamine gated) exists but is frozen. The model is
  deterministic; five fixed pixel jitters stand in for trial noise.

Every module carries a docstring saying the physiology is a proxy and unvalidated. Those
caveats are accurate and should carry over to our README.

## 3. Pilot results (measured today)

The full pipeline was built in a scratch directory to check feasibility before planning.

### Speed

| Step | Wall time |
|---|---|
| Download 1.1 GB and compile graph | ~7 min, once |
| Load brain into memory | 0.7 s |
| 500 ms of neural time, whole brain | 0.9 s |

A one-second ad exposure with blanks costs about two seconds of compute. With ten to twenty
control variants per ad this is roughly one ad per minute per process, and the machine has
headroom for several processes.

### Readout populations exist by name

All the cell types we would want to read from are typed in the annotations:

| Population | Cells | Role in a real fly |
|---|---|---|
| T4a-d, T5a-d | ~13,600 | Local motion direction |
| LC4, LPLC2, LC6, LC16 | 617 | Looming and escape ("swat") |
| LC10a/b/d | 584 | Small-object tracking, courtship |
| LC11, LC18 | 351 | Small dark objects |
| visual_projection superclass | 9,201 | Everything leaving the optic lobe |
| Approach / avoidance MBONs | 22 | Innate valence ("buy") |
| DNa02, DNp09, MDN, DNp02, DNp11 | 12 | Steering, forward, backward, escape |

### The visual signal dies at the lamina

This is the finding that shapes the plan. Mean firing rate per cell during a 500 ms
stimulus after a 500 ms grey settle:

| Stage | grey | white | black | dark disc | left half black |
|---|---|---|---|---|---|
| R1-R6 photoreceptors | 124 Hz | 130 | 4 | 111 | 83 |
| L1 lamina | 29 Hz | 28 | 51 | 32 | 38 |
| L2 lamina | 15 Hz | 15 | 24 | 16 | 19 |
| Mi1, Mi4, Mi9, Tm1-Tm9, Tm20 (medulla) | 0 | 0 | 0 | 0 | 0 |
| T4, T5 (motion) | 0 | 0 | 0 | 0 | 0 |
| LC4, LPLC2 (looming) | 0 | 0 | 0 | 0 | 0 |
| Approach minus avoid MBON, mV | 9.1 | 9.4 | 9.4 | 8.9 | 34.8 |

Photoreceptors and lamina respond as expected for a sign-inverting first synapse: black
raises L1 and L2 firing. But nothing downstream of the lamina fires at all, under static,
looming, receding, striped or drifting stimuli. A looming disc, the stimulus LC4 and LPLC2
exist to detect, produces zero spikes in either.

The reason is structural, not a bug. The fly optic lobe up to T4/T5 is a graded-potential
system: cells sit at a resting release level and signal by depolarising *or*
hyperpolarising. L1's output to Mi1 is glutamatergic and inhibitory; in a real fly the ON
pathway works by *disinhibition*. A leaky integrate-and-fire cell with no tonic input cannot
be disinhibited into firing, so the ON and OFF pathways both go dark at the first medulla
synapse. Bananflugakompassen's 12 mV lamina bias papers over this for exactly one layer.

Consequence: the mushroom body valence used for the Valkompass answers is not seeing the
image. Its 9 mV baseline moves by a few tenths across every stimulus tried, and the one
large jump (left half black, 35 mV) is a hemispheric asymmetry of the screen mapping, not
a preference. The Valkompass answers in that repo are, in effect, a deterministic hash of
the screenshot's brightness layout. Fun, but not a judgment.

## 4. What the experiment should be

### The question

Does a whole-connectome fly brain, shown two ads side by side, produce responses that
(a) depend on image structure and not just brightness, (b) are stable under nuisance
transforms, and (c) predict anything humans care about, such as eye-tracking salience or
click-through? (a) and (b) are testable with no external data. (c) needs a dataset.

The fly cannot read. Copy, brand, offer and positioning are invisible to it. What it can
in principle see is layout, contrast, colour (blue vs green), motion, looming, small
objects, and left/right balance. That is what "pre-attentive salience" should mean in our
copy, and every result should be framed that way.

### Stimuli

- Static ads as PNG or JPEG, resized with padding to the fly's 320×180 screen.
- Video ads as frame sequences at 100 Hz neural sampling (10 ms per frame), phase 3.
- Per ad, a fixed set of **null controls** generated automatically: pixel-scrambled (same
  histogram, no structure), phase-scrambled (same spectrum), 20 px blur, greyscale,
  luminance-matched flat grey, left/right mirror, inverted. If an ad scores the same as its
  scramble, the fly is measuring brightness and we say so.
- **Reference stimuli** with known real-fly answers, run in CI: looming disc (LC4, LPLC2
  should fire), drifting grating (T4/T5 should be direction-selective), small moving dot
  (LC11), ON and OFF flashes (L1 vs L2 split). These are the gate for phase 0.

### Protocols

1. **Solo**: grey 500 ms, ad 1000 ms, grey 500 ms. Score against the grey baseline.
2. **Pair**: ad A in the left eye's field and ad B in the right eye's, 1000 ms, then swapped.
   Scores are averaged over the swap so screen-side bias cancels. This is the literal
   "side by side" and it uses the existing overlapping viewport split as-is.
3. **Tournament**: every pair in a set of N ads, both orders, fitted with a Bradley-Terry
   model to give each ad a rating and a confidence interval.
4. **Dwell** (phase 3): show the ad until a novelty measure on the optic lobe habituates;
   report time-to-boredom. Adapted from FlyScroll.

### Readouts

Each readout is a named, versioned function of spike counts or voltages over a window,
so we can add and compare them without touching the protocol code.

| Name | Population | Reads as |
|---|---|---|
| `swat` | LC4 + LPLC2 + LC6 + LC16, and DNp02/DNp11 | threat, escape drive |
| `buy` | approach minus avoidance MBONs | innate valence |
| `gaze` | LC10 group + LC11 + LC18 | object interest |
| `motion` | T4/T5 by direction subtype | motion energy and direction |
| `turn` | DNa02 left minus right | which side the fly steers toward |
| `salience` | total visual_projection spikes, retinotopic map | where on the ad the fly "looks" |
| `boredom` | slope of optic lobe rate over exposure | habituation |

The `salience` map, drawn as a heat overlay on the ad, is the shareable artifact per ad.

### Noise and confidence

The simulator is deterministic. Use the jitter trick from Bananflugakompassen (fixed
pixel shifts and gain changes) plus small random initial-voltage perturbations, at least
ten trials per condition, and report the mean and a bootstrap interval. Never print a
score without its interval. A difference between two ads that is smaller than the
difference between an ad and its own jitter is not a difference.

### Baselines to beat

Compute for every ad: mean luminance, RMS contrast, edge density, colourfulness, and a
classical saliency map (spectral residual or Itti-Koch, both cheap in OpenCV). Fit each
fly readout against these. If a fly score is fully explained by mean luminance, the
whole-brain simulation added nothing and the honest headline is that. If it is not
explained, we have something to write about.

## 5. Architecture

```
swat-or-buy/
  fly/            # neural/ from Bananflugakompassen, verbatim, MIT attribution in THIRD_PARTY.md
  vision/         # phase 0 work: tonic drive tuning, or flyvis front-end adapter
  stimuli/        # loaders, resize/pad to 320x180, null-control generators, reference stimuli
  protocols/      # solo, pair, tournament, dwell
  readouts/       # registry of named readouts; each returns value + per-trial samples
  baselines/      # pixel statistics and classical saliency
  cli.py          # swat score ad.png | swat compare a.png b.png | swat tournament dir/ | swat report
  report/         # static HTML report: per-ad salience heatmap, scores with intervals, controls
  tests/          # reference stimuli gates, determinism check, checksum of graph arrays
  results/        # parquet per run, git-ignored
```

Python 3.11+, uv, numpy, pandas, pyarrow, Pillow, OpenCV for baselines. Runs must be
reproducible from a lockfile of the data checksums, which the inherited `prepare.py`
already enforces. A run record stores the graph checksum, readout versions, protocol
parameters and per-trial samples.

Parallelism: one brain per process at about 3 GB, so six to eight workers on this machine.
A tournament of 20 ads is 380 ordered pairs × 10 trials × 2 s, about two hours on eight
cores. Fine for a studio experiment; a web front-end would need a queue.

## 6. Phases and gates

**Status 2026-09-13 evening.** Phases 1 to 3 are built and running (`swatorbuy/`, see README):
solo, pair and tournament protocols, still and video input, six null controls, pixel
baselines, the fly map, the gate, a self-contained report, a FastAPI hosted service with a web
front-end, Docker. Phase 0 option A was tried and failed: a uniform tonic bias of 5 to 8 mV on
medulla and projection cells makes them fire at 0.1 to 6 Hz but gives no discrimination
(looming vs receding, drift left vs right, disc vs scramble all identical; LC4 stays at 0 Hz).
Option C ships: `glance`, `boredom` and the fly map carry signal; deep readouts are greyed
out by the gate. Option B (flyvis front-end) is the open work item. The template repo
cobanov/fly-connectome-template was evaluated and not used: it is a React/Three.js viewer of
soma positions with a replay format and no simulator, under a custom attribution licence.

**Status 2026-09-13 night.** The browser tier exists in `app/`: the eye circuit cut to
29,195 neurons (the lamina only matched the full brain once the Dm amacrine cells were
included), a TypeScript kernel validated against the Python reference on five screens, a Web
Worker, a Three.js eye view and a screen view with drag, resize, side by side, video and a
glance map, in the visual idiom of hrook1/Swat. Static build, Vercel-ready (project root
`app`). Kernel speed at 0.1 ms is 1.7× real time in Node.

**Later the same night**, after Oskar's feedback (own identity rather than a Swat copy,
explained numbers, easy add/remove, a game-show verdict): the app got its own palette and
type, an ad tray for two contestants, a judge mode in the worker (grey, ad, shuffled pixels,
flat grey, face-off both ways) paced by the narration, a first-person reasoning stream where
every sentence is a measurement, round banners, a crosshair on the hottest lamina columns, a
scorecard, and a verdict scene with BUY stamp, swatter and confetti. Ranking rule: layout-
driven glance (ad minus shuffled), then side-by-side share, then hold. Remaining: a fly body
in the eye view, replays and share cards, mobile polish, sound, and the flyvis route so the
deep brain has something to show.

### Phase 0: make the optic lobe see (1 to 2 weeks)

Nothing else is worth doing until a looming disc makes LC4 fire. Three options, ordered by
how much they respect the connectome:

**A. Tonic drive tuning.** Give medulla and lobula cell types a resting current so they can
be inhibited and disinhibited, the way the inherited code already does for the lamina. The
`tonic` array per neuron exists in `MemoryBrain`. Tune per cell type against the reference
stimuli until ON/OFF split, T4/T5 direction selectivity and LC4 looming responses appear
qualitatively. Cheap to try, keeps everything in one simulator, but the tuned values are
our invention and every result carries that footnote.

**B. flyvis front-end.** Render the ad onto flyvis's 721-column hex retina, run its graded
64-type optic lobe, and inject its per-column T4/T5/Tm/TmY outputs as currents into the
matching MaleCNS cells (matched by type and by `assignedOlHex1/2` column). Everything from
the lobula outward, including LC neurons, mushroom body and descending neurons, then runs
in the MaleCNS spiking model. This is what ommatid did. Better validated vision, more moving
parts, PyTorch dependency, and the seam between the two models is our engineering.

**C. Lamina-only readout.** Accept that the model is a contrast-and-colour detector, read
out L1/L2/L3 and Dm cells and call it a "first-glance" score. Honest, quick, and
uninteresting as science.

Recommendation: do C on day one so there is a working end-to-end pipeline, run A and B in
parallel for a week, and pick whichever passes the reference stimuli gate. If neither
does, C ships with the caveat stated plainly and phases 1 to 3 still work as a fun demo.

Gate: looming disc drives LC4/LPLC2 above a receding disc; drifting grating produces
direction-tuned T4/T5 rates; scrambled ad differs from the ad in at least one readout.

### Phase 1: solo scoring pipeline (1 week)

Fork the simulator, build `stimuli/`, `readouts/`, `baselines/`, the solo protocol and the
CLI. Ship the per-ad HTML report with salience heatmap, all readouts with intervals, and the
null-control comparison. Gate: two visibly different real ads get different scores, and each
differs from its own scramble beyond the jitter interval.

### Phase 2: side by side and tournament (1 week)

Pair protocol with swap averaging, DNa02 `turn` readout, Bradley-Terry ratings over a set.
Gate: tournament ratings are stable when ads are re-run with new jitter seeds (rank
correlation above 0.8 across two independent runs).

### Phase 3: video and dwell (1 to 2 weeks)

Frame sequences at 10 ms, the `motion` readout, the `boredom` habituation protocol. This
is where fly vision is actually strong, and where video ads and animated banners become
first-class.

### Phase 4: does it mean anything (2 to 3 weeks, needs data)

- Correlate readouts against a human saliency model (DeepGaze or similar) on the same ads.
- If the studio has campaign performance data (CTR, view-through, thumb-stop rate) for a set
  of creatives, correlate fly ratings against it, with the pixel-statistics baselines as
  the null model.
- Write it up either way. "A 166,700-neuron connectome predicts ad performance no better
  than mean luminance" is a publishable and shareable result.

### Phase 5: shareable front-end (optional)

Upload two ads, get a side-by-side verdict with heatmaps, a "swat" and "buy" gauge and the
control comparison. Runs on a queue against a Mac mini or a cloud box with 4 GB per worker.
Only worth building if phase 1 produces something people want to look at.

## 7. Risks and honest caveats

- **The fly may never see structure.** Phase 0 might fail for both A and B within the time
  box. Then the project is a luminance detector with a very expensive front-end. The plan
  survives this because phases 1 to 3 still ship, but the copy must say so.
- **Everything downstream of the lamina is an engineering choice.** Synapse count times
  0.275 mV, transmitter signs from a classifier, LIF for graded cells, no gap junctions, no
  receptor types, no neuromodulation. Results are about this model, not about flies.
- **A male brain looking at ads.** LC10 is a courtship-tracking circuit. Expect jokes.
- **Determinism cuts both ways.** Same ad, same answer, forever. Good for reproducibility,
  bad for pretending the jitter interval is biological variance.
- **Licences.** Simulator MIT, data CC BY 4.0, flyvis MIT. Attribution lines go in
  THIRD_PARTY.md and the README. Ads we test must be ones we have the right to run.

## 8. Decisions needed

1. Phase 0 appetite: two weeks on A and B in parallel, or ship C and treat the rest as a
   demo?
2. Static first or video first? The plan says static, but if the use case is paid social
   video, phase 3 should move ahead of phase 2.
3. Is there campaign performance data we can use for phase 4, and for which creatives?
4. Name and voice of the output. "Swat" and "buy" as the two gauges is the obvious hook.
