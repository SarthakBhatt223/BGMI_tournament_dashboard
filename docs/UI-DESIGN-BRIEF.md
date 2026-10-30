# AARAMBH 4.0 — UI Design Brief

Everything on screen, panel by panel, so it can be redesigned without reading code.
Two separate pages share one live data feed:

| | **Admin panel** `/admin` | **Display panel** `/display` |
| --- | --- | --- |
| Who uses it | The operator, on a laptop, up close | The audience, on a TV/projector, from far away |
| Purpose | Enter data and control what the audience sees | Show results; nothing to click |
| Screen | Laptop/desktop browser, about 1200 px content width | Full screen, designed for **1920 × 1080 (16:9)** |
| Interaction | Mouse, keyboard, forms | None (cursor is hidden) |
| Theme today | Light, neutral blue (placeholder) | Dark, neutral (placeholder) |
| Updates | Live (Socket.IO) | Live (Socket.IO), no refresh needed |

The operator controls the display from the admin panel: **Broadcast tab → mode buttons**. The display never decides anything by itself except the scheduled leaderboard (section 1.6).

---

## 0. What a designer can and cannot change

**Free to change:** colours, fonts, spacing, sizes, borders, shadows, icons, animations, backgrounds, how the information is laid out, the look of every button/table/card/badge.

**Fixed by the data (can be hidden or re-arranged, but the information exists):**
- Standings columns: rank, team (logo + name), WWCD count, placement points, finish points, total points.
- A team has: name, optional 1–6 character tag, optional logo (PNG/JPEG/WebP). With no logo the app shows a small box with the first 3 letters of the tag/name.
- A player has: name, optional in-game name.
- Brand-new screens need new code, but the data for them is listed in section 4.

**Current style tokens** (all in `client/src/styles/variables.css`, so a re-skin is mostly editing values):
- Admin: background `#f4f5f7`, panels white, text `#1b1f24`, muted `#5c6670`, accent blue `#2f5d9e`, danger red `#a12626`, warning `#fff4d6`, info `#e3eefc`.
- Display: background `#101214`, surface `#1a1d21`, text `#f1f3f5`, muted `#9aa3ad`, rank 1/2/3 = gold `#d4a933`, silver `#aeb6bf`, bronze `#b87a45`.
- Player Finish Audit tab (already themed): charcoal `#171A20`, orange `#FF7A1A`, green `#35C46A`, amber `#F2B01E`, red `#EF5350`.
- Font: system sans-serif. Base size 15 px (admin). Display text scales with screen height (`2.4vh`).
- The brand direction in the original brief is **black / orange / green**; the display and the admin shell are not yet in that style.

---

# PART 1 — DISPLAY PANEL (`/display`)

One full-screen page. Three **modes**, switched by the operator. Layers from back to front: ambient video, then the active mode's panel on top, then a small connection badge.

## 1.1 Page frame
- Full-screen, no scrollbars, no cursor.
- Text and spacing use screen-relative units so it scales from a 1080p TV to other sizes.
- **Safe margin:** content stays 4% away from the screen edges (about 77 px left/right, 43 px top/bottom at 1080p).
- Background behind panels: solid dark.

## 1.2 Mode: AMBIENT (default idle screen)
- A looping, muted, full-screen video (`ambient.mp4`), cropped to fill the screen.
- It stays running underneath the other modes, so going back to ambient is instant.
- **Fallback if the video is missing:** centered grey text "Ambient video not found" plus a hint with the file path. A designer should supply a still background for this case if wanted.
- Nothing else is shown in ambient mode today (no logo, no clock).
- *Design opportunity:* an overlay on the video (event logo "bug", sponsor strip, clock, next-match text). Not built yet.

## 1.3 Mode: LEADERBOARD
The panel covers the whole screen with a solid background.

**Header (top, with a thin bottom line)**
- Left: **Headline** (large, 1.7× text). Shows the operator's custom headline, otherwise the event name ("BGMI AARAMBH 4.0").
- Under it: **Subtitle** (muted). The operator's custom subtitle, otherwise the tagline from settings, otherwise hidden.
- Right, right-aligned, muted: section label **"Standings"**, and under it the current match label (for example "Match 1" or "Match 2 - Erangel").

**Table (fills the rest of the screen)** — columns, in order:

| Column | Content | Notes |
| --- | --- | --- |
| # | Rank | Bold |
| Team | Logo + team name | Logo is 1.6 em square; name is cut off with "…" if too long |
| WWCD | Number of winner-winner-chicken-dinners | Right-aligned |
| Placement | Placement points | Right-aligned |
| Finish | Finish points | Right-aligned |
| Total | Total points | **Bold**, right-aligned |

- A small uppercase muted **header row** labels the columns.
- **Top 3 rows** are highlighted: a coloured left bar (gold / silver / bronze) and a slightly lighter row background.
- Rows share the available height equally, with thin separator lines.
- Numbers use fixed-width digits so columns line up.

**Layout variants (chosen by the operator in Broadcast tab):**
1. **Full:** every active team on one screen (18–20 rows fit at 1080p).
2. **Compact (paged):** `teamsPerPage` rows at a time (default 10). Row height stays the same on the last, shorter page (extra space is left empty).
   - **Page indicator** bottom-right, muted: "Ranks 11-20 - Page 2 of 2".
   - Pages **cross-fade in 0.5 s**.
   - Which page shows is decided by the server: each time the leaderboard appears, it shows the next page (page 1, then 2, then 1 …).
   - Optional: pages can also flip by themselves every N seconds.

**Empty state:** "No teams registered" (muted, centered).

## 1.4 Mode: MVP SHOWCASE
Same header as the leaderboard but the section label says **"MVP"**. Below it, two columns (about 1.4 : 1):

**Left — MVP card** (only when the operator has picked an MVP)
- Portrait placeholder: a neutral head-and-shoulders silhouette in a square, about 28% of screen height. *(No real photos exist in the app; a designer can define a photo frame.)*
- Small label "MVP"
- **Player name** (very large, 2.2×)
- In-game name (muted, if set)
- Team name (muted)
- **Total finishes** — big number (2×) followed by the word "finishes"
- A small muted list per match: "Match 1: 5", "Match 2: 3" …

**Right — "Most finishes (supporting statistic)"** list: one row per top player with name, team (muted) and finish count (bold). Rows have thin separators. The MVP is **always chosen manually**; this list is only supporting information.

**Empty state (no MVP chosen):** "MVP not selected yet — The organizer will announce the MVP." plus the finishes list.

## 1.5 Connection badge (all modes)
- Small dark rounded pill, bottom-right, amber text.
- Hidden while connected. Shows "Connecting…" or "Connection lost - last update 14:32:05" so the operator notices a dead link. Designers should keep it subtle but visible.

## 1.6 Built in the backend but NOT yet drawn on screen (needs design)
These two exist as data/events; the display does not render them yet.

**A. Scheduled leaderboard overlay** (appears over the ambient video)
- Every 5 minutes (configurable) for 15 seconds (configurable), 9 teams per page, alternating page 1 / page 2 (18 teams = ranks 1–9, then 10–18), then back to ambient.
- Data: page number, total pages, the page's rows (rank, logo, name, finishes, placement points, total points), start/end time, duration.
- Design needs: a compact "popup" look (full-screen panel or a side/bottom card over the video), enter/exit animation, a visible "Page 1 of 2" indicator, and ideally a countdown/progress bar for the 15 seconds.

**B. Elimination notification** ("TEAM A eliminated by TEAM B")
- Data: eliminated team (name, tag, logo), credited team (name, tag, logo), optional credited player (name, in-game name), match number, time.
- Design needs: a toast/banner that animates in over any mode and auto-hides (suggested 4–6 seconds), with both logos; plan for several arriving close together (queue or stack).

---

# PART 2 — ADMIN PANEL (`/admin`)

## 2.1 Sign-in screen (only if an admin secret is set)
Small centered page: heading "Admin sign-in", one sentence of explanation, a **password field** ("Admin secret"), **Sign in** button, red error text for a wrong secret.

Other full-page states: "Checking server…" and "Cannot reach the server" (with a **Try again** button).

## 2.2 Page shell (all tabs)
1. **Header bar:** left — event name (large) with "Admin panel" under it; right — **connection status** text (Connected / Connecting… / Disconnected - data may be out of date; colour changes) and a **Sign out** button (only with a secret).
2. **Tab bar** (wraps on small screens). Active tab is highlighted. Tabs in order:
   **Dashboard · Scoring · Player Finish Audit · Roster · Player stats · Broadcast · Settings · Backup**
3. **Error banner** at the top of the content: red box with the message, an optional bullet list of reasons (for example why a match cannot be finalized), and a **Dismiss** button. A second one appears for errors from the +/- buttons.
4. **Content area:** max ≈1200 px wide, centered, made of **panels** (white boxes with a border) stacked with equal gaps.

## 2.3 Tab: DASHBOARD (the home screen)
- **Overview panel:** a row of small label/value pairs — Event, Teams, Players, Current match, Display mode, Connection.
  - Button row: **Go to scoring**, **Player finish audit**, **Manage roster**, **Broadcast controls**.
  - Yellow warning if some teams have fewer players than expected ("2 team(s) have fewer than 4 players: …").
  - Yellow warning if the ambient video file is missing.
- **Standings panel:** the same table as the display (rank, team with logo, WWCD, placement, finish, total) with the top 3 tinted gold/silver/bronze. Empty state: "No teams yet — Add teams in the Roster tab."

## 2.4 Tab: SCORING (team-level scoring for one match)

**Panel 1 — Match controls**
- Dropdown **Current match** (lists every match with its status; also decides what the display shows as the match label).
- A context button: **Start match** (if planned) / **Finalize match** (if in progress; asks to confirm) / **Reopen for correction** (if finalized; asks for a reason).
- Form: **New match label** (optional text, for example the map) + **Create match**.
- Small line: "Status: in progress".

**Panel 2 — Team scoring**
- **Header:** match name; status line; right side three numbers — **Placements entered 12/18**, **Finish totals entered 14/18**, and a **Provisional / Finalized** badge (yellow / green).
- Yellow warning list for duplicate placements ("Placement 2 is assigned to more than one team") and missing placements.
- Blue info message when scoring is locked ("Start the match…" or "This match is finalized…").
- **Table**, one row per team:

| Column | Content |
| --- | --- |
| Rank | Rank inside this match |
| Team | Name, plus a green **WWCD** badge for the winner |
| Finishes | **[ − ] number [ + ]** stepper, and a small status text ("Saving…", "Saved", or a red error) |
| Finish points | Calculated by the server |
| Placement | Dropdown 1…N (options taken by another team are disabled and show the owner's name), plus a red **Duplicate** or amber **Missing** tag |
| Placement points | Calculated |
| Total points | Bold |

- Duplicate rows tint red, missing rows tint yellow. A **footer row** sums the columns. The table scrolls sideways on narrow screens.
- The **−** button is disabled at 0; all controls disable when the match is not in progress.

## 2.5 Tab: PLAYER FINISH AUDIT (dark theme — already styled)
Entered **after** the match from the official results, to check that players' finishes add up to the team totals. It never changes team points.
- **Header:** title, one-line explanation, **Match** dropdown.
- **Summary strip:** *Teams reconciled 14/18* (large; green when all match), Mismatched (red), Incomplete (amber), Team finishes, Player finishes, Incomplete rosters.
- Amber notice when the match is finalized (with **Reopen for correction**) or not started.
- **Search box** (team, tag, player, in-game ID).
- **Team accordion**, one collapsible row per team. Row header: arrow, team name + tag chip, "Team finishes: 12", "Player total: 12", "Difference: +2" (only when wrong), and a status chip — **MATCH** (green), **MISMATCH** (red), **INCOMPLETE** (amber). The coloured left edge repeats the status.
- **Expanded team:** optional amber/red notes (incomplete roster, how many finishes are unassigned), then one row per player: name, "ID: in-game name" (muted), a large **[ − ] count [ + ]** (the + is orange, − disabled at 0), and a status text (Saving… / Saved / error).

## 2.5b Tab: ROSTER
One panel "Teams and players":
- **Add team form:** Team name, Abbreviation (optional, 6 characters), **Add team**.
- A list of **team cards**, one per team (inactive teams look faded). Each card:
  - Top row: logo (or initials box), team name input, abbreviation input, **Save**, **Deactivate/Activate**, **Delete** (red outline; disabled with an explanation once the team has match history).
  - **Logo** file chooser (PNG/JPEG/WebP, 2 MB) and **Remove logo**.
  - Yellow warning when the roster is incomplete.
  - **Player rows:** player name input, in-game name input, "move to team" dropdown, **Save**, **Deactivate/Activate**, **Delete**.
  - **New player** input + **Add player**.

## 2.6 Tab: PLAYER STATS
- **Search** box (player, in-game name or team).
- Table: **Rank · Player (with in-game name in grey) · Team · Total finishes · By match** ("M1: 5, M2: 3"). Empty states for no players / no search result.

## 2.7 Tab: BROADCAST (controls the display)
**Panel 1 — Public display**
- **Display mode** — three toggle buttons: **Ambient video · Leaderboard · MVP showcase**. The active one is dark/filled.
- **Leaderboard layout** — two toggles: **Full (all 18 teams)** and **Compact (10 per page, 2 pages)**.
- A line "Compact leaderboard shows page 1 of 2 now…" and a **Next leaderboard page** button.
- **Page flip interval** (number, seconds) + **Apply interval**.
- **Display headline** and **Display subtitle** text inputs + **Apply text**.

**Panel 2 — MVP**
- Dropdown **MVP player** ("Name (Team)"), "Not selected" option.
- **Most finishes** numbered list (name, team, count).

## 2.8 Tab: SETTINGS
- **Event panel:** Event name, Organizing club, **Save event**.
- **Scoring and display configuration panel:** a grey note about placeholder scoring, a **large monospace JSON editor** (26 rows), an inline red error for invalid JSON, **Save configuration** and **Reset editor to saved**.
  - *Design opportunity:* turn the JSON into real form fields (placement-points table, tie-breakers, scheduled-leaderboard timings, teams per page).

## 2.9 Tab: BACKUP
- **Backup and restore panel:** **Export backup (JSON)**, **Restore from backup file** (file chooser; asks for confirmation), grey help text, blue result message.
- **Recent activity panel:** **Load latest 50 actions** button, then a table **Time · Action · Details**.

## 2.10 Admin features that exist in the backend but have no screen yet
- **Record an elimination** (choose eliminated team, credited team, optional player → creates the event the display will show), list of recorded eliminations for the match, and a **Void** button.
- **Scheduled leaderboard settings** (on/off, interval, duration, teams per page) and a "next appearance in 3:12" indicator.

---

# PART 3 — SHARED COMPONENTS (design once, reuse)

| Component | Where | Variants / states |
| --- | --- | --- |
| Primary button | everywhere | normal, disabled (45% opacity) |
| Secondary button | Deactivate, Sign out, Dismiss… | outlined |
| Danger button | Delete | red outline |
| Toggle button | display mode, layout | active (filled dark) vs inactive |
| Large button | `+1`-style actions | bigger padding |
| Panel | all tabs | white box, border, 4 px radius |
| Form row | all forms | labels above inputs, wraps |
| Input / select / textarea / search / file chooser | all forms | normal, focus |
| Table | standings, scoring, players, audit log | header row, zebra not used, top-3 tint |
| Stepper `[−] n [+]` | scoring, audit | disabled, saving/saved/error text |
| Badge / chip | Provisional, Finalized, WWCD, MATCH/MISMATCH/INCOMPLETE, Duplicate, Missing | green, amber, red, grey |
| Message boxes | warnings, info, errors | yellow, blue, red |
| Empty state | tables and lists | centered grey title + sentence |
| Team logo | tables, cards | image, or initials box fallback |
| Connection badge | admin header, display corner | connected, connecting, disconnected |
| Tab bar | admin | active, inactive |
| Accordion row | audit, could reuse for roster | collapsed, expanded |

---

# PART 4 — SAMPLE DATA FOR MOCK-UPS

**Real teams currently registered (18, 4 players each; tag in brackets):**
FALLEN4 [FALLEN] · Core Faction [CORE] · TEAM PIXEL PIRATES [TPX] · SuperVillains [SV] · Fallen 4 [F4] · Guardians Esports [GDS] · APEX UNIT [AXU] · Lagging Legends [LL] · ETERNAL LEGION [EL] · Godza Esports [Godza] · Congressxbjp [CB] · Infernos United [INFU] · Dubai Esports [DUB] · OG [OG] · Gambhir Graphians [GG] · Chikne Cheethe [CHT] · TEAM KDVM [KDVM] · 7SINS [7SINS]

**An example standings row (invented numbers, for mock-ups only):** rank 1 · team "Core Faction" · WWCD 1 · placement points 15 · finish points 12 · total 27 · finish count 12.
Default points: finish = 1 point each; placement 1st = 10, 2nd = 6, 3rd = 5, 4th = 4, 5th = 3, 6th–10th = 2 *(placeholder table — confirm with the organizer)*.

**Long names to test:** "TEAM PIXEL PIRATES", "Gambhir Graphians", player "N0xi0us乛Max十", "ISHOT • KAHNA" (special characters must render).

**A match:** "Match 3 - Erangel", status in progress, 18 teams, 12/18 placements entered.

---

# PART 5 — WHAT TO DESIGN (suggested deliverables, 1920 × 1080 unless noted)

**Display (highest priority — the audience sees these):**
1. Leaderboard — full, 18–20 rows.
2. Leaderboard — compact page 1 and page 2 (10 rows) with the page indicator.
3. Scheduled leaderboard overlay over a video frame (9 rows, "Page 1 of 2", countdown).
4. Elimination notification (two logos + text), over a game-footage frame.
5. MVP showcase — with a photo frame and the empty state.
6. Ambient overlay (optional): logo bug / clock / sponsor strip, plus the "video missing" still.
7. Connection badge.

**Admin (laptop, ~1440 × 900):**
8. Shell: header, tab bar, panel, error banner.
9. Scoring tab (the busiest screen — operators use it live, so large tap/click targets matter).
10. Player Finish Audit (already themed — align it with the rest).
11. Broadcast tab with the three mode buttons very clear (a wrong click goes live on the TV).
12. Roster, Dashboard, Settings, Backup, sign-in.

**Also decide and write down:** colour palette (black/orange/green), one display font + one UI font (free Google Fonts if they must be used on a web page), logo files (transparent PNG/SVG), and how rank 1–3 are highlighted.

---

# PART 6 — DESIGN RULES THAT PROTECT LIVE USE
- **Distance legibility:** on the display, text should stay readable from the back of a hall — avoid body text under about 24 px at 1080p and low-contrast greys on the video.
- **Safe margin 4%** on the display, since some TVs crop edges.
- **No scrolling** on the display; everything must fit or be paged.
- **Colour is never the only signal** (admin): pair red/green/amber with text such as MATCH / MISMATCH, as the audit tab does.
- **Dangerous actions look different** (Delete, Finalize, Restore) and confirm before running.
- **Live safety:** the three display-mode buttons should show clearly which mode is live right now.
- **Fixed-width digits** for all scores so columns do not jump when numbers change.
