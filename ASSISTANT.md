# Feasibility assistant

A Claude chat panel inside the feasibility app. It reads the model's own source, so it
answers questions about the financial logic from the real formulas; it proposes input
changes you apply or discard; and it runs the two Sobha deck skills locally.

## Running it, step by step

**1. Start the bridge.** Double-click `assistant\start-assistant.cmd`.

A black window opens and should print:

```
Feasibility assistant bridge
  listening   http://localhost:8787
  project     ...\Australia code
  app         ...\Australia_Land_Feasibility_Paddington_Clean_No_Defaults.html
  model       claude-opus-5
```

Leave that window open for as long as you want the assistant. Closing it stops the
assistant; it does not affect the feasibility app. It uses your existing Claude Code
sign-in, so there is no API key to set.

If it says the port is already in use, the bridge is already running in another
window. Use that one.

**2. Open the app.** Double-click
`Australia_Land_Feasibility_Paddington_Clean_No_Defaults.html` exactly as you always
have.

**3. Open the panel.** An **Assistant** pill sits at the bottom right. Click it.

**4. Check it connected.** The dot next to "Assistant" in the panel header should be
green and the label should read `connected`.

If it stays grey and says `offline` while the bridge window is clearly running, your
browser is blocking a local request from a page opened off disk. Open
<http://localhost:8787/app> instead. Same file, same panel, everything else identical.
That is the only difference, and you only need to find out once.

**5. Confirm it can see the model.** Type:

> how is gross revenue calculated

It should quote the real code from the file, naming `run()`, `sum("recog")` and the
unit sale price loop. If it answers in vague generalities instead, it is not reading
the source and something is wrong.

**6. Confirm proposals work.** Type:

> raise the land price to A$12,000 per sqm

A card should appear showing `pr`, the old value, the new value and the effect. Click
**Apply**, watch the headline numbers move, then click **Undo last change** and watch
them come back.

**7. Confirm a deck builds.** Click **Generate E1 deck** with nothing attached. It runs
off the current site and model. A deck appears in the chat with a Download button in a
few minutes.

## What it can do

**Explain the model.** Ask how any number is calculated. It greps the HTML and quotes
the actual expression rather than describing it from memory.

**Change inputs.** Ask for a change and it proposes one. You get a diff card showing
field, unit, before and after, and what it does to the headline numbers. Nothing moves
until you click Apply. Undo last change reverts it.

**Build decks.** Two buttons above the composer:

- **Generate E1 deck** — the 3-slide lead summary. Works with an attached lead
  document, or with nothing attached, in which case it builds from the current site
  and model.
- **Generate D1 deck** — the 2-slide Active-to-Potential recommendation. Attach the
  E1 `.pptx` first; D1 reads it.

Attach PDFs, images, PPTX, DOCX or XLSX with the Attach button, or drag them onto the
panel. Finished decks land in `assistant-runtime\output\` and appear in the chat with
Download and Show in folder.

## Where the data comes from

Both skills follow `.claude\skills\_shared\data-priority.md`:

1. **The attached file** wins. Always.
2. **The application** next: the Site Intelligence map (address, LGA, zoning, FSR,
   height limits, measured distances to stations, schools and shopping, ABS population
   and income) and the feasibility model (GRV, PPSM, units, saleable area, GFA, margin,
   programme).
3. **Web research** only for what is still missing — median unit price, dwelling mix,
   growth rates, comparable sales, agent and vendor detail.
4. Anything still unresolved is left blank and goes on the verification checklist.
   Nothing is invented to fill a gap.

Analyse a site on the Site Intelligence tab before generating a deck and tier 2 covers
far more, which means less scraping and better sourcing on the deck's sources slide.

## Layout

```
.claude\skills\lead-one-pager\SKILL.md            E1
.claude\skills\d1-active-to-potential\SKILL.md    D1
.claude\skills\_shared\data-priority.md           the file > app > web policy
.claude\skills\_shared\pptx.md                    local pptxgenjs reference
.claude\skills\_shared\read-pptx.mjs              reads PPTX, DOCX and XLSX text
assistant\server.mjs                              the bridge
assistant-runtime\uploads\                        attachments
assistant-runtime\context\state.json              live app snapshot, rewritten per turn
assistant-runtime\output\                         generated decks
```

The panel itself is appended to the end of the HTML as `assistant-chat-style` and
`assistant-chat-runtime`. Nothing above those blocks was modified.

## Notes

- Decks are PPTX. Open them in PowerPoint and check them before sending anything on;
  both skills stamp an auto-generated disclaimer and a verification checklist for that
  reason.
- Change the port with `set ASSISTANT_PORT=9000` before starting, and the model with
  `set ASSISTANT_MODEL=claude-sonnet-5`.

## If a deck is taking too long

Most of the time in a deck run is web research, not slide building. Three levers:

**Analyse the site on the map first.** Site Intelligence tab, search the address, draw
or select the polygon, run Analyse site. That fills address, LGA, zoning, FSR, height
limits, measured distances to stations, schools and shopping, and ABS population and
income. E1 Slide 2 then needs no searching at all, and Slide 3 needs less. This is the
single biggest saving and it also improves the sourcing on the deck.

**Attach the source document.** Anything in the attachment is tier 1 and is never
re-checked against a search.

**Lower the reasoning effort** if you want to trade some care for speed:

```
set ASSISTANT_EFFORT=medium
node server.mjs
```

Accepts low, medium, high, xhigh, max. Unset means high. Slide layout QA is the first
thing to suffer at lower effort, so check the deck before sending it on.

The skills are capped at six searches per deck, issued as one parallel batch, one round
only. Fields that round does not resolve are left blank and listed on the verification
checklist. Speed never comes from inventing a number.
