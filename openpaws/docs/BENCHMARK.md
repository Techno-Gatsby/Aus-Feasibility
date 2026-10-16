# Benchmark: OpenPaws vs Furever Dock and open-source desktop pets

Researched October 2026.

**Sources**
- 18 open-source repositories, each cloned and read.
- Furever Dock's public website and terms of service.
- The resource folders of the Furever Dock 2.0.2 macOS build.

Licences were checked from each repository's own LICENSE file and asset credits. This is an engineering review, not legal advice.

## Feature matrix

Y = yes, P = partial or via a plugin/fork, – = no, ? = not confirmed from public information. The Furever Dock column comes from its website, its terms and the names of the folders in its app bundle.

| Feature | Furever Dock | OpenPaws | OpenPets | vscode-pets | Shimeji-ee | eSheep | WindowPet | VPet | DyberPet | Clippy | Open-LLM-VTuber |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Licence | proprietary | **MIT** | MIT | MIT | zlib | MIT | MIT | Apache | GPL-3 | MIT | MIT |
| Lives on the dock / taskbar | Y | **Y** | Y | (panel) | Y | Y | Y | Y | Y | – | – |
| Climbs walls, walks the ceiling | ? | **Y** | ? | P | Y | Y | Y | Y | ? | – | – |
| Gravity, drag and throw with momentum | ? | **Y** | Y | – | Y | Y | Y | ? | Y | – | – |
| Chases the cursor, hunting crouch and pounce | Y | **Y** | Y | – | Y | – | – | – | ? | – | – |
| Toys (ball, feather wand, laser) | wand, snack | **ball, wand, laser** | – | ball | – | – | – | P | P | – | – |
| Cats play with each other | ? | **Y** | P | Y | Y | Y | – | – | – | – | – |
| Walks between monitors | ? | **Y** | Y | n/a | Y | Y | ? | ? | ? | – | – |
| Walks off screen and comes back | Y | **Y** | ? | – | – | – | – | – | – | – | – |
| Gesture / action orb menu | Y | **Y** | – | – | – | – | – | – | – | – | – |
| Trick skills (sit, beg, high-five…) | Y | **12 trainable tricks** | – | – | – | – | – | – | – | – | – |
| Needs, XP, levels | ? | **Y** | P | – | – | – | – | Y | Y | – | – |
| Treats / currency | paid | **earned by being productive** | – | – | – | – | – | Y | Y | – | – |
| Adoptable presets with profiles | 20 | **18 cats, 19 coats** | 1 | 26 types | packs | packs | packs | 1 | mods | 1 | models |
| Adoption certificate | Y | **Y (PNG)** | – | – | – | – | – | – | – | – | – |
| Pet from your own photo | Y (paid, cloud AI) | **Y (free, on-device AI)** | – | – | – | – | – | – | – | – | – |
| Behaviour animations from video | Y (AI-generated) | **Y (your own clips)** | – | – | – | – | – | – | – | – | – |
| Living-photo motion from one still | ? | **Y (mesh warp)** | – | – | – | – | – | – | – | – | – |
| Imports community sprite packs | ? | **Shimeji** | Codex atlas | – | Y | Y | Y | Y | Y | – | Live2D |
| AI chat | Y (Gemini) | **Claude, OpenAI, Gemini, Ollama, any OpenAI-compatible, offline** | Y | – | – | – | – | Y | P | Y (local) | Y |
| Tool use (reminders, weather…) | Y | **18 tools** | Y | – | – | – | – | – | – | – | Y |
| Long-term memory and user summary | Y | **Y, editable** | P | – | – | – | – | – | – | P | P |
| Email-based suggestions | Gmail | **Outlook (Microsoft 365) and Gmail, read-only** | – | – | – | – | – | – | – | – | – |
| Calendar heads-ups | Y | **ICS feeds and Outlook** | P (Google) | – | – | – | – | – | – | – | – |
| Weather | Y | **Y, with umbrella, rain and snow on screen** | – | – | – | – | – | – | – | – | – |
| Natural-language reminders with repeats | Y | **Y** | Y | – | – | – | – | – | Y | – | – |
| Pomodoro and healthy-habit nudges | ? | **Y** | Y | – | – | – | – | P | Y | – | – |
| Idle, lock and late-night awareness | ? | **Y** | – | – | – | – | – | – | – | – | – |
| Voice: speech and push-to-talk | ? | **cat babble, TTS, STT** | Y | – | – | – | – | – | – | – | Y |
| Works fully offline | ? (cloud account) | **Y** | P | Y | Y | Y | Y | Y | Y | Y | P |
| Account required | Y | **no** | no | no | no | no | no | no | no | no | no |
| Platforms | macOS, Windows | **macOS, Windows, Linux** | all three | VS Code | Win (+mac fork) | Windows | all three | Windows | all three | all three | all three |

## Measured

| What | Result |
|---|---|
| Physics and behaviour engine | 2.4 µs per frame for 1 cat, 18 µs for 12 cats, 31 µs for 30 cats (Node 22) |
| Drawing a vector cat | ~1.1 ms per cat per frame walking, 0.55 ms asleep, on a software canvas (no GPU). The overlay drops to ~12 fps while all cats rest. |
| Fast background removal (U²-Net small, 4.6 MB) | 0.25–0.7 s per photo on 4 CPU cores |
| Best background removal (IS-Net, 179 MB) | 1.2–5.5 s per photo on 4 CPU cores |
| Cutout accuracy | IoU 0.99 on three cats composited onto busy, soft-focus room backgrounds (both models) |
| Photo → living desktop cat, end to end in the packaged app | 3.3 s, including the first model download |
| Automated tests | 39 (engine, reminders, brain and tool loops, calendar, inbox heuristics, cutout pre/post-processing) |

## What was reused, and how

**MIT code, adapted with attribution** (see NOTICE.md):
- OpenPets' throw velocity tracker.
- OpenPets' pixel-accurate hit testing.

**Ideas and file formats**
- Clippy and Open-LLM-VTuber: emotion tags at the start of AI replies.
- Shimeji-ee: the standard pose image indices, used to import packs.

**Not used: bundled art.** Almost all of it is third-party IP, non-commercial or no-derivatives, or has unclear provenance. This covers the vscode-pets cats and dogs, the Shimeji defaults, the eSheep and WindowPet packs, and the VPet animations. OpenPaws draws its own cats and makes photo cats from your own pictures instead.

**Not used: copyleft projects.** DyberPet, Shijima-Qt and clawd-on-desk were read as references only.
