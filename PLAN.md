# UI redesign plan (Airbnb-style layout)

Scope: `site/index.html`, `site/app.css`, `site/app.js`, plus a new `site/featured.json`.
Untouched: scoring (`scoreOf`, `rescoreAll`), filtering (`run`), data loading (`load`, `ensureBranches`,
`getHist`, geocoding), everything under `scripts/` and `site/data/`.

## 1. Inventory: everything the current UI does, and where it goes

### Header
| Today | After |
|---|---|
| "CRE Lender Finder" wordmark + `meta-line` (quarter, bank/CU/branch counts) | Wordmark in Jost 700 uppercase; counts move to a muted subtitle under the landing search and into the footer row of the results header |
| `macro-line` (fed funds, SOFR, 5y, 10y, SLOOS) | Kept as a slim muted strip under the header (hidden under 768px, as today under 900px) |
| Definitions / About & sources links | Kept, top right, text buttons |

### Search and lookup
| Today | After |
|---|---|
| Address box + Search button; Enter submits | Pill segment 1 "Address"; Search button at the pill's right end; Enter submits |
| `addr-result` line (resolved label + state, or errors) | Shown under the pill (landing) / under the compact pill (results) |
| `?q=` URL param runs a search on load | Unchanged |
| Click map to drop a pin (runs search, clears `?q=`) | Unchanged (map visible in results state) |
| Find a lender box with suggestions, acronyms, arrow keys, Enter, Esc | Kept: a second field "Find a lender" in the header (results) and under the pill (landing). Same `findLenders` code |
| Loan use select (`occ`: investment / owner-occupied); changing it rescores and reruns | Pill segment 2 "Loan use" + a filter chip |
| Amount (`amt`, accepts $ or $M) | Pill segment 3 "Amount" + chip showing the value |
| Lender types: banks, thrifts, credit unions | Pill segment 4 "Lender type" (popover with the 3 checkboxes) + 3 toggle chips |

### Filters modal (opened by "Filters" button; chip row shows a count of non-default settings)
- Geography mode radio (HQ within N mi / HQ in state or within N mi AND branch within M mi) with `r-hq`, `r-hq2`, `r-br`
- Include single/multiple common-bond credit unions (`f-fom`)
- Only lenders with CRE on the books (`f-anycre`)
- Six weight sliders with live values, hint text, and "Reset"
- Footer buttons: "Reset all" (text), "Show N lenders" (applies and closes; the count is live)
- The existing element ids are kept, so `run()`, `weights()` and the wiring keep working unchanged

### Results
| Today | After |
|---|---|
| Summary line (N lenders, banks/CUs, mode, amount, scoring basis) | Heading above the list, same text |
| Table: 31 columns, column visibility by loan use, click-to-sort headers with tooltips, sticky first column, name opens drawer | "Table" view: same table, same sort; sort markers changed from arrow glyphs to the words "high–low" / "low–high" and `aria-sort` |
| Download CSV | Kept in Table view (and available in Cards view toolbar) |
| — | New "Cards" view (default): one card per lender in the same order as the table's default sort (score, high to low). Card: tier pill, score, name, Bank/CU (+thrift, LICU), HQ city and distance, branches near, assets, investment or OO CRE, CRE growth 4Q, lending limit. Click opens the drawer |
| Map above table, HQ circles sized by assets, branch dots, property pin, radius circle, legend, popups for HQ and branch | Sticky map on the right (40%). HQ circles become HTML pill markers with the tier letter, tier-colored. Branch dots, pin and radius circle stay as map layers. Legend becomes text pills "A B C D E", "Branch", "Property" |
| HQ popup | Mini-card popup: name, type, tier, score, assets, inv. CRE, "Details" link opens the drawer (the "→" arrow is removed) |
| Branch popup with deposits, growth, share, quartile | Unchanged content, restyled |

Linking: hovering a card highlights its marker (raised, outlined, z-index up); hovering a marker highlights the
card and scrolls it into view only if the user isn't scrolling the list; keyboard focus on a card behaves like hover.

### Drawer and modals
- Lender drawer: header, meta line, score cards, history table with same-quarter/all-quarters toggle, branch table.
  Content unchanged; "×" becomes a "Close" text button; Esc closes; focus returns to the card that opened it.
- Definitions and About modals: unchanged text; "Close" button; Esc closes.
- Footer disclaimer and "Data built" date: kept.

### Behaviors that must survive
Weights slider live rescoring, occ change rescoring, every filter change re-running `run()`, CSV export,
`?q=` deep links, dropped pins, branch lazy-loading by state, offline mode (`CFG.offline`), lender search.

## 2a. Observed on airbnb.com (studied 2026-10-03 at 1440px and 375px)

**Landing**
- No hero image: the search pill sits centered in a white header band; content rows start right below it.
- Pill ~850×66px, fully rounded, thin shadow. Segments ~280px each: small bold label ("Where") over a gray
  placeholder ("Search destinations"), separated by thin vertical dividers. Round accent button at the right end.
- Clicking a segment: the whole bar turns light gray, the active segment becomes a raised white pill, and the
  round button widens to show the word "Search". A rounded panel (~32px radius, soft shadow) opens under the
  active segment; its rows are "label + small gray hint" on the left and the control on the right, split by hairlines.
- Rows: left-aligned title ("Popular homes in Port Aransas") with a small link arrow; previous/next round buttons
  top right; ~7 cards visible at 1440px, each a square-ish image with 12px radius, a translucent white badge pill
  top-left ("Guest favorite": 14px, weight 600, 14px radius, layered soft shadow), then a bold-ish title line and a
  small gray meta line. Rows scroll horizontally.

**Results**
- Header compacts to a small pill ("Homes in Corpus Christi | Any week | Add guests" + round button).
- Chip row under the header: "Filters" first, then outlined pill chips (~32px tall).
- Title "Over 1,000 homes in Corpus Christi" with a small gray note under it.
- Split ≈ 50/50 at 1440px: two-column card grid on the left; the map is an inset panel with rounded corners and a
  margin, sticky, with an expand control and zoom.
- Markers: white pills with dark bold text and a soft shadow. Hovering a card inverts its marker to dark with white
  text and raises it. Crowded markers collapse into small dots.
- Clicking a marker opens a mini card anchored above it (image, title, rating, short meta, price, close button).
- Filters modal: centered ~570px, title centered at top with close button, sections split by hairlines,
  segmented control for exclusive choices ("Any type | Room | Entire home"), sticky footer with an underlined
  "Clear all" text button on the left and a dark "Show 1,000+ places" button on the right.

**Mobile (375px)**
- Compact pill at top with a filters button, chip row, map on top and a draggable bottom sheet with the list.
  Your spec (list only + floating "Show map" / "Show list" button) is simpler and works better for a 31-column data
  set, so I'll follow the spec rather than the bottom sheet.

**Adjustments to the plan from this**
- Markers: white pill, tier letter in the tier color, thin tier-colored border; hovered/active marker inverts to
  a filled tier color with white text and rises above the others. Matches Airbnb's inversion while keeping tier colors.
- Lender type / Loan use segments open Airbnb-style panels (rows with label + hint + control), not native selects.
- Geography mode in the Filters modal becomes a two-option segmented control ("HQ nearby" | "In state + branch nearby")
  with the radii under the selected option.
- Filters modal footer: "Reset all" text button left, "Show N lenders" button right, live count.
- Map in results is an inset rounded panel, as Airbnb does. Split stays 60/40 per your spec (Airbnb is ~50/50);
  lender cards are a single column of wide data cards rather than a two-up grid, since they carry numbers, not photos.
- Landing card rows have no photos: cards lead with a large tier letter tile and the lender name instead.

## 2. Airbnb patterns mapping

- **Landing state** (no `S.pt`): centered pill search bar (Address | Loan use | Amount | Lender type | Search),
  "Find a lender" field under it, then horizontally scrolling rows from `featured.json`:
  "Featured lenders", "Lenders with profiles", "Sponsored in {state}" (state dropdown on that row).
  Map hidden in this state. Skeleton cards while `lenders.json` loads.
- **Results state**: sticky header with the compact pill (shows "Address · Use · Amount"; clicking expands it),
  chip row + "Filters" button, split view (list 60% / map 40%), Cards/Table toggle.
- **Mobile (<768px)**: list only; floating "Show map" / "Show list" text button; filters modal full screen.
- **Style**: white background, one accent (deep blue, not Airbnb's coral), 12px radius, soft shadows,
  generous spacing, visible focus rings (2px accent outline + offset), AA contrast checked for tier pills
  (white text on the five tier colors; C and D will be darkened slightly to pass 4.5:1).

## 3. featured.json and placements

`site/featured.json` (hand-edited, committed; not generated):

```json
[{ "id": "B16835", "type": "featured|profile|sponsored", "states": ["TX"], "blurb": "...",
   "profile_url": "https://...", "start_date": "2026-10-01", "end_date": "2026-12-31", "placeholder": true }]
```

- `id` uses the site's own ids: `B` + FDIC cert, `C` + NCUA charter number. A bare number would be ambiguous,
  since FDIC certs and NCUA charter numbers overlap.
- Entries outside start/end dates or whose id is not in the current data are skipped.
- "Sponsored in {state}" reads the state from `localStorage` (`lm.sponsorState`) via a single
  `currentSponsorState()` function, so a logged-in borrower's state can replace it later. When there is a search,
  the property's state is the default.
- Rules enforced in code: every paid placement (`featured` and `sponsored`) carries a visible "Sponsored" label;
  placements never touch `score`, `tier`, `S.results` or its order. In results, at most one labeled
  "Sponsored" slot appears above the ranked list, visually separate and not numbered.

## 4. Typography, icons, tables

- Google Fonts link + preconnects exactly as specified; `--font-sans`, `--font-display`, `--font-serif` on `:root`;
  no other `font-family` declarations (the current `--mono` and `--sans` are removed).
- Wordmark: display 700 uppercase 0.04em. Titles/section headings: serif 600, -0.015em. Subtitles: serif 400.
  Small labels: sans 600 uppercase 0.1em. Everything else sans 400/500.
- No icons/glyphs/emoji: replace "×" (drawer, modal), "▾/▴" sort markers, "→" in the popup. Keep the "×0.85" penalty
  multipliers in text (they are math, not icons). MapLibre zoom controls stay.
- Every table (results, drawer history, drawer branches, any in modals): first column left, all others centered,
  vertical-align middle, `tabular-nums` on data columns.

## 5. Build order (one commit each)

1. **Layout**: fonts, tokens, header, landing vs results states, split view, sticky map, drawer/modal Close buttons, table alignment rules.
2. **Search bar**: pill with four segments + Search, compact pill in results, lender-type popover, Find a lender placement.
3. **Filters modal**: move geography, membership, CRE-only, weights; chip row; Reset all; Esc/focus trap.
4. **Cards and marker linking**: Cards/Table toggle, card list, pill markers, hover linking both ways, mini-card popup.
5. **Landing rows**: featured.json with 3 placeholder entries per type, three rows, state dropdown + localStorage, skeletons.
6. **Mobile**: under 768px list only, Show map / Show list button, full-screen modal and drawer.

Verification after each step and at the end: 375, 768, 1440px widths in the browser pane; keyboard-only pass;
contrast check; and a script that runs the same addresses (233 S Wacker Dr Chicago; Yoakum, TX in both geography
modes; a ZIP; a dropped pin) on the current live site and the redesigned copy and confirms identical lender ids in
identical order.

Commits stay local until the full set passes; then one push (each push to `site/` rebuilds the data, ~15 min).

## 6. Open questions

1. **Placeholder sponsors on the live site:** the 9 seed entries would show real banks labeled "Sponsored" or
   "Featured" when none have paid, which a visitor could take as a real endorsement. Recommendation: mark seeds
   `"placeholder": true` and show them only on a preview URL (`?preview=1`) or locally, so the public site shows
   no placement rows until real entries exist.
2. **Default view:** Cards by default, Table one click away. Recommended, since the table has 31 columns.
