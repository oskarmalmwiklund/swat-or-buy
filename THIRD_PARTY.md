# Sources and attribution

- `swatorbuy/fly/` is copied, with the environment variable and model tag renamed, from
  [Bananflugakompassen](https://github.com/Fluffet/bananflugakompassen) (`neural/`,
  `prepare.py`), itself copied from [Stonkfly](https://github.com/nftechie/stonkfly) and
  [DOOMFLY](https://github.com/nftechie/doomfly), copyright © 2026 nftechie and DOOMFLY
  contributors, MIT License. The upstream licence text is in `LICENSE.upstream`.
- [MaleCNS v1.0](https://male-cns.janelia.org/) connectome data: the MaleCNS collaboration
  (FlyEM / HHMI Janelia, University of Cambridge, MRC Laboratory of Molecular Biology, Google
  Research), Creative Commons Attribution 4.0. Downloaded separately by `swat prepare`; see
  `swatorbuy/fly/datasets.json` and `swatorbuy/fly/sources.lock.json`.
- The test tube in the Multiply Labs badge (`app/src/labs/badge.ts`) is TestTube01 from
  [Hugeicons](https://hugeicons.com) core free icons, MIT.
- Approach and avoidance MBON sets follow Aso et al. 2014, eLife, doi:10.7554/eLife.04580.
- Spectral residual saliency follows Hou and Zhang 2007.
- Fonts in the Python report page are loaded from Google Fonts (Bricolage Grotesque, IBM Plex);
  the `app/` bundle ships Bricolage Grotesque and DM Sans via Fontsource (SIL Open Font License).
- The visual design of `app/` (layout, palette, typography) follows [Swat](https://github.com/hrook1/Swat)
  by hrook1, used as a reference; no code was copied. `app/` depends on Three.js (MIT).

## Sample ads

The vintage sample ads under `app/public/samples/` are real advertisements in the public
domain (published before 1929, or by authors dead more than 70 years), downloaded from
Wikimedia Commons at 720 px and re-encoded as JPEG. Each file's Commons page carries the
full provenance.

| File | Ad | Commons file |
|---|---|---|
| `app/public/samples/vintage-coca-cola-1890s.jpg` | Coca-Cola (1890s) | Cocacola-5cents-1900 edit1.jpg |
| `app/public/samples/vintage-kodak-1900.jpg` | Kodak (1900) | Folding Pocket Kodak Camera ad 1900.jpg |
| `app/public/samples/vintage-pears-1912.jpg` | Pears' Soap (1912) | Bubbles by Sir John E Millais.png |
| `app/public/samples/vintage-michelin-1898.jpg` | Michelin (1898) | Michelin Poster 1898.jpg |
| `app/public/samples/vintage-menier-1894.jpg` | Chocolat Menier (1894) | Affiche Chocolat Menier-Bouisset-1894.jpg |
| `app/public/samples/vintage-robette-1896.jpg` | Absinthe Robette (1896) | Privat-Livemont - Absinthe Robette, 1896.jpg |
| `app/public/samples/vintage-campari-1921.jpg` | Bitter Campari (1921) | Bitter Campari affiche, Leonetto Cappiello.jpg |
| `app/public/samples/vintage-kelloggs-1909.jpg` | Kellogg's (1909) | Kellogg's Toasted Corn Flakes (1909) (ADVERT 427).jpeg |
| `app/public/samples/vintage-moulin-rouge-1891.jpg` | Moulin Rouge (1891) | Moulin Rouge – La Goulue, by Henri de Toulouse-Lautrec.jpg |
| `app/public/samples/vintage-job-1896.jpg` | Job (1896) | Alphonse Mucha - Job Cigarettes 1.jpg |
| `app/public/samples/vintage-victor-1920.jpg` | Victor (1920) | His Master's Voice (1920).jpg |
| `app/public/samples/vintage-ivory-1898.jpg` | Ivory Soap (1898) | You need only one soap-Ivory soap - the Strobridge Lith. Co., Cin'ti & New York. LCCN00650433.jpg |
| `app/public/samples/vintage-ford-1908.jpg` | Ford (1908) | 1908 Ford Model T.jpg |

The `mock-*` and `ad-*` sample ads are mock creatives for fictional brands, made for this
project, and are covered by the project licence.
