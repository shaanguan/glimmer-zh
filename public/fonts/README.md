# Public webfont assets

These are the publicly distributed **DM Sans** and **Inter** fonts from Google Fonts, fetched on **2026-11-09**. They are used as open alternatives for the Latin typography described in the visual reference. They are not the LottieFiles-branded “DM Sans LF” or “Inter LF” builds.

## Files and supported styles

| File | Public font family | Style | Variable weight range | Subset | Size |
| --- | --- | --- | --- | --- | --- |
| `dm-sans-latin-variable.woff2` | DM Sans | Normal / upright | **400–700**, continuous | Latin | 24,988 bytes |
| `inter-latin-variable.woff2` | Inter | Normal / upright | **400–700**, continuous | Latin | 38,368 bytes |
| `DM-Sans-OFL.txt` | DM Sans | Original license and copyright notice | — | — | 4,482 bytes |
| `Inter-OFL.txt` | Inter | Original license and copyright notice | — | — | 4,377 bytes |

For a local `@font-face` declaration, use `font-style: normal`, `font-weight: 400 700`, `font-display: swap`, and `format("woff2")`. The public CSS family names are `DM Sans` and `Inter`.

Only the normal-style Latin subset was downloaded. No italic, Latin Extended, Cyrillic, Greek, Vietnamese, or Chinese subset is included. Keep the website’s system Chinese font fallback. There is no need for a runtime request to Google Fonts once these local files are referenced.

## Unicode subset

Google Fonts returned the following **Latin `unicode-range` declaration** for both files. This is the API’s subset declaration, not a promise that every code point in every interval has a glyph:

```text
U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F,
U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
U+FEFF, U+FFFD
```

## Official sources

The exact public Google Fonts CSS request used to select the files:

<https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..700&family=Inter:wght@400..700&display=swap>

The files were copied unchanged from the `/* latin */` declarations in that response:

- **DM Sans WOFF2:** <https://fonts.gstatic.com/l/font?kit=rP2-p2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopwDRUUHvP-6oMc49xLtf0DPCjGtNio&skey=cd068b3e1b767e51&v=v17>
- **Inter WOFF2:** <https://fonts.gstatic.com/l/font?kit=UcCB3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfU5NJeWUdIOjBeTGiXZdND2MVsiEu&skey=c491285d6722e4fa&v=v20>
- **DM Sans specimen:** <https://fonts.google.com/specimen/DM+Sans>
- **Inter specimen:** <https://fonts.google.com/specimen/Inter>
- **DM Sans license:** <https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt>
- **Inter license:** <https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt>

License files were downloaded verbatim from the corresponding `raw.githubusercontent.com/google/fonts/main/ofl/…/OFL.txt` URLs.

## License and attribution

Both fonts are distributed under the **SIL Open Font License 1.1 (OFL-1.1)**. The license permits use, embedding, and redistribution in commercial websites and software, subject to its terms. Keep the original copyright notices and the complete license files with the distributed fonts. The font files must remain under the OFL and must not be sold by themselves. See the included license texts for the full terms and any conditions on modified fonts and reserved names.

- DM Sans: Copyright 2014 The DM Sans Project Authors (<https://github.com/googlefonts/dm-fonts>).
- Inter: Copyright 2020 The Inter Project Authors (<https://github.com/rsms/inter>).

The downloaded WOFF2 files have not been modified locally. Using these public fonts does not imply endorsement by Google, the font authors, or LottieFiles.

## File verification

Both files have a valid WOFF2 signature and were successfully decoded for metadata inspection. Each has a single `wght` variation axis with minimum **400**, default **400**, and maximum **700**. Neither file contains Chinese ideographs.

| File | Embedded version | Encoded Unicode characters | SHA-256 |
| --- | --- | --- | --- |
| `dm-sans-latin-variable.woff2` | `Version 4.004;gftools[0.9.30]` | 222 | `3692732c335296930f21b662b52038873abdb353c6b00d7e27fe8567b1a75f5d` |
| `inter-latin-variable.woff2` | `Version 4.001;git-66647c0bb` | 230 | `36d9123969412a89ae97f31306450e5f006b27b6c85db72526b0659c9d02ca59` |

The DM Sans binary’s legacy family name is `DM Sans 9pt`; Google Fonts exposes this asset under the CSS family name `DM Sans`. This download contains the weight axis only, with no adjustable optical-size axis.
