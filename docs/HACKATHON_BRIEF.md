<!-- trace: source=hackathon-scout (main session, curl of SSR payload) | event="BUIDL CTC 2026 Fall" | url=https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail | fetched=2026-09-11 | mode="hackathon" | weights="JUDGING WEIGHTS NOT PUBLISHED — one criterion quoted: Depth of Attestcoin Protocol utilization" | deadline="2026-09-13 23:59 ET (2026-09-14 03:59 UTC), extended once; ~66h at fetch" -->
# Hackathon Brief: BUIDL CTC 2026 Fall

> ⏰ TIME REMAINING: ~66 hours at fetch time (2026-09-11 09:40 UTC). Deadline 2026-09-13 23:59 ET = 2026-09-14 03:59 UTC. Re-check the page before submitting — it has already been extended once.
> Confidence: ✅ HIGH for deadline, tracks, prizes, deliverables, form fields, rules (all from the official page's server-rendered payload). ⚠️ Judging weights, judges and past winners are NOT published — see Gaps.
> Sources: https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail (SSR payload, curl with browser UA — WebFetch returns 405) — fetched 2026-09-11
> Source-of-truth status: ✅ official page. Submission-form field list taken from the payload's `submissionForm` JSON, which is what the portal renders.

## Summary
- **Event**: BUIDL CTC 2026 Fall — "BUIDL For The Real World"
- **Organizer**: Creditcoin & Credit Labs (sponsor series); CertiK winner benefits
- **Format**: online, DoraHacks portal
- **Dates**:
  - Submissions open: August 13, 2026
  - Online AMA: August 18, 2026 (recording: https://youtu.be/HPL6LjTqQm4)
  - Submission deadline: **September 13, 2026, 23:59:00 ET (Extended)** = 2026-09-14 03:59 UTC
  - Winners announced: September 20, 2026
- **Time budget (hands-on)**: ~66 h from fetch; build is complete, remaining time is packaging
- **Eligibility**: "All team members must — Have no criminal record; Have no pending criminal cases; Not be residents of sanctioned countries; Not be sanctioned individuals; Be legally permitted to participate under applicable local laws." Minimum team size 1.
- **Track lock**: payload `isMultiTracksAllowed: false` — exactly one track per BUIDL. Ours: **DePIN**.

## Tracks
| Track | Description (verbatim) | Prize | Judging weight |
|-------|------------------------|-------|----------------|
| DeFi | "Build lending, trading, liquidity, or yield applications on Creditcoin. Demonstrate how the network powers practical, transparent on-chain financial applications." | overall pool | not published |
| RWA | "Tokenize, manage, or finance real-world assets on Creditcoin to seamlessly bridge off-chain value with on-chain transparency." | overall pool | not published |
| **DePIN** | "Build DePIN applications that utilize cross-chain data to drive incentives, settlement, or coordination across hardware and sensor networks." | overall pool | not published |
| Gaming | "Create games or gaming infrastructure on Creditcoin featuring in-game economies, asset ownership, and player-driven marketplaces." | overall pool | not published |
| AI | "Deploy AI apps on Creditcoin that process cryptographically verified cross-chain data to autonomously inform decisions and trigger on-chain transactions without centralized oracle operators." | overall pool | not published |

Prizes are **overall**, not per track — track choice buys narrative coherence, not a separate pool.

## Mandatory tech (DIRECT QUOTES)
> "Every submission this season must leverage the Attestcoin Protocol." — detail page, *The Theme*
> "The Attestcoin Protocol was previously introduced under the name Universal Smart Contracts (USC)." — detail page
> "Projects must demonstrate a meaningful and functional integration with the Attestcoin Protocol. Requirements for a complete submission: Working Attestcoin Protocol integration code running within your project. Technical documentation detailing your setup and explaining how the project uses the Attestcoin Protocol." — detail page, *Attestcoin Protocol Integration Requirement*
> "Must be deployed on a testnet. Must integrate the Attestcoin Protocol as a core feature." — detail page, *Project Requirements*

Developer resources named by the organizer: docs.attestcoin.org (chains & environments, guided tutorials, Attestcoin SDK / USC SDK).

## Sponsor list & their interests
- **Creditcoin / Credit Labs**: the whole event; wants ecosystem expansion via Attestcoin Protocol usage across five verticals. Top three teams enter the **CEIP fast-track** (Creditcoin Ecosystem Investment Program: "advance directly to the due diligence stage" — investment, engineering/product advisory, partner/VC network).
- **CertiK**: winner benefits — "8K credits toward a repository audit", "3 months of Skynet Boost". Signals that auditability / security posture of the repo is looked at.

## Judging criteria (DIRECT QUOTES — never invent)
| Criterion (EXACT wording from source) | Weight (only if quoted) | What judges look for (quote) |
|---------------------------------------|-------------------------|------------------------------|
| "Depth of Attestcoin Protocol utilization will be evaluated as one of the core scoring criteria." | not published | "Show how your project meaningfully integrates the Attestcoin Protocol, whether through trustless cross-chain DeFi, tokenized real-world assets, gaming economies, or verifiable governance." |
| JUDGING WEIGHTS NOT PUBLISHED — downstream phases must not assume weights | — | The theme copy emphasises: "verified cross-chain data", "execute cross-chain business logic without relying on centralized oracle operators", "BUIDL For The Real World". |

## Judges (if found — Step 3.5)
No judge list is published on the event page. Not found — listed under Gaps. Archetype inference only: sponsor DevRel/engineering (Creditcoin/Gluwa) → deep, correct SDK use; Credit Labs (investment arm, CEIP) → real-world use case and a path to launch; CertiK → security posture.

## Deliverables (mandatory)
- [ ] Working Attestcoin Protocol integration code running within the project
- [ ] Technical documentation detailing setup and how the project uses the Attestcoin Protocol
- [ ] Deployed on a testnet
- [ ] GitHub Repository URL (must include a README) — **required form field**
- [ ] Project Deck or Whitepaper (PDF URL) — **required form field**
- [ ] Prototype Demo Video URL — **required form field**
- [ ] Attestcoin/USC Integration Summary — **required form field** (free text)
- [ ] Project Name, Sector, Description — required form fields; Logo image URL optional
- [ ] Every team member registered on DoraHacks with the registration form (Country of Residence + Country of Citizenship required)

## Submission mechanics
- Portal + exact submission-form fields (from payload `submissionForm`, in order):
  1. Project Name — required
  2. Project Logo (Image URL - PNG, SVG, or AI, optional) — optional
  3. Project Sector (e.g., DeFi, RWA, DePIN, Gaming, AI) — required
  4. Project Description — required
  5. USC Integration Summary (explain how your project uses USC) — required *(page text calls it "Attestcoin Protocol Integration Summary")*
  6. GitHub Repository URL (must include a README) — required
  7. Project Deck or Whitepaper (PDF URL) — required
  8. Prototype Demo Video URL — required
- Registration form (per member, from payload `registrationForm`): First & Last Name*, Email*, Telegram ID, X / Twitter, LinkedIn, Resume (PDF URL), Short Bio*, Role within the team*, Country of Residence*, Country of Citizenship* (* = required)
- Demo-video max length + format rules: `DATA TIDAK DITEMUKAN: video length/format` — none stated; a URL is all the form takes
- Repo visibility + pre-existing-code rules: "Must be original work created during the hackathon." (Aug 13 – Sep 13). Repo must "include a README". Visibility not stated; public is the only safe reading of "Repository URL". Payload flags `mandatoryGitRepoLink:false, mandatoryVideoLink:false` for DoraHacks' native fields, but the custom form marks both **required** — treat as required.
- Terms: "All submitted information is accurate and truthful. They possess full rights and ownership to use all code, content, and materials submitted."
- Help: team@creditcoin.org; Discord https://discord.gg/Gu43zTfmtc, channel #buidl-ctc-qna

## Prize structure
- Total: $15,000 — Grand Prize $10,000 · 2nd $3,000 · 3rd $2,000 (overall, across all five tracks)
- Track prizes: none separate
- Special awards: CertiK — 8K audit credits + 3 months Skynet Boost for all winning teams ("CMC listing support is not included")
- Non-cash: top three → CEIP fast-track (skip screening, straight to due diligence; initial investment, advisory, partner/VC network)

## Past winners patterns (from past edition pages)
Not fetched — the page links no prior edition and the fetch budget was spent on the live page. Listed under Gaps.

## Submission gallery (Crowding + freshness evidence — feeds /theme, /ideate, /critique)
- This edition: https://dorahacks.io/hackathon/buidl-ctc-2026-fall/buidl (client-rendered; SSR payload carries no entries)
- Prior edition: `DATA TIDAK DITEMUKAN: gallery URL`
- Fetch hint: DoraHacks BUIDL list is loaded by XHR after page load — needs a real browser
- Entry count seen: payload `teamCount: 3`, `hackersCount: 292` at fetch time

## Red flags / gotchas
- The deadline was **extended** (page says "(Extended)"); the todo/spec previously recorded the same 2026-09-14T03:59Z — confirm on the day of submission.
- Deck/Whitepaper **must be a PDF URL** and the demo **must be a URL** — hosting is on us (GitHub raw link, Google Drive, YouTube).
- Each team member fills in Country of Residence and Country of Citizenship in their **own** DoraHacks registration; it cannot be done for them at submit time.
- Single-track only; picking DePIN is final.
- Form label says "USC Integration Summary" while the page says "Attestcoin Protocol Integration Summary" — same field; use the current name and note the old one once.
- "Must be original work created during the hackathon" — the repo's first commit is 2026-09-11; the README and architecture doc date the build to Sept 7–11, inside the window.

## Gaps requiring user input
- Judging rubric weights: not published anywhere on the page.
- Judge names: not published.
- Past-edition winners: not linked from the page.
- Demo-video length limit: none stated.
- **Weakest-evidence field**: judging weights. Downstream must not assume a split; the only stated criterion is Attestcoin depth, so the package should lead with it.

## Raw excerpts
See `docs/BRIEF_RAW.md`.
