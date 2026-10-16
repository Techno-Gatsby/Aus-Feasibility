# Notices and credits

OpenPaws is MIT-licensed (see `LICENSE`). It ships no third-party artwork: every cartoon cat, prop, icon and effect is drawn in code (`src/renderer/shared/draw.js`, `effects.js`, `scripts/icons.html`).

## How OpenPaws relates to Furever Dock

OpenPaws is an independent, clean-room project inspired by the commercial app Furever Dock. Nothing of Furever Dock is included: no code, artwork, companion images, names, stories or text.

- **No executable was decompiled.** The archive provided for reference contained only resources: a companion catalogue, preset pet images and UI asset folders. Its executables were not in the archive.
- **Only the feature set was used.** It was taken from Furever Dock's public website and terms of service, plus the names of the asset folders in that archive (for example `skills/`, `reminder/` and `adoption-certificate/`).
- **What OpenPaws builds instead:**
  - All 18 adoptable cats, their names and their stories are original.
  - Photo-real cats are made from *your own* photos, with on-device AI.

## Code adapted from other projects

### OpenPets (MIT)
- `src/renderer/shared/engine.js` (`releaseVelocity`) adapts the throw velocity tracker in `apps/desktop/src/pet-throw-core.ts`. Throws use the last 100 ms of pointer motion, and a pointer held still for 80 ms is a drop, not a throw.
- `src/renderer/shared/sprites.js` (`alphaHit`) follows the idea of `pet-alpha-hit-test.ts`: a pixel-accurate opacity check with a small sampling radius, so clicks pass through transparent parts of a photo cat.

```
MIT License

Copyright (c) 2026 OpenPets

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Ideas and formats from other projects

| Project | Licence | What we took |
|---|---|---|
| Clippy by Felix Rieseberg | MIT | The pattern of the model opening each reply with an animation keyword. |
| Open-LLM-VTuber | MIT | The `[emotion]` tags that drive the character. |
| Shimeji-ee | zlib-style | The meaning of the standard `shime1.png`–`shime46.png` image indices, used to import packs (`SHIMEJI_MAP` in `sprites.js`). No Shimeji code or images are included. |

## Models downloaded at runtime (not bundled)

| Model | Licence | Notes |
|---|---|---|
| U²-Net small (`u2netp.onnx`) | Apache-2.0 | By Xuebin Qin et al. (2020). Default "Fast" background removal. |
| IS-Net general use (`isnet-general-use.onnx`) | Apache-2.0 | By Xuebin Qin et al., DIS (2022). Optional "Best" background removal. |

- Both ONNX exports come from the release assets of the rembg project by Daniel Gatis (MIT).
- Each download is checked against a pinned SHA-256 before use.

## Libraries

| Package | Licence | Use |
|---|---|---|
| Electron | MIT | Desktop runtime |
| electron-builder | MIT | Installers |
| ONNX Runtime (`onnxruntime-node`) | MIT | On-device AI inference |
| `@anthropic-ai/sdk` | MIT | Claude provider |
| chrono-node | MIT | Natural-language dates |
| node-ical | Apache-2.0 | Calendar feeds, time zones, recurrence |
| pngjs | MIT | Tests only |

## Services (only when you use them)

| Service | Licence / terms | Use |
|---|---|---|
| Open-Meteo | CC BY 4.0 | Weather and geocoding. Weather data by Open-Meteo.com. |
| ipwho.is | — | Approximate location, only when you press "Detect". |
| Microsoft Graph, Gmail API | — | Your own app registration; read-only scopes. |
| Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Ollama, LM Studio | Their own terms | Only the provider you choose, with your own key. |
