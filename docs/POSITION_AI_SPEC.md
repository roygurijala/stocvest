# POSITION_AI_SPEC — Position desk AI (glass-box) — ADR-004

**Status:** POS-AI-1 shipped (`position_thesis_packet.py`); POS-AI-2 (Investment Read) in progress.
**Invariant:** AI is a **research and narration layer**. It never sets, upgrades, or overrides pillar scores, verdicts, or `decision_state`. Every AI-surfaced claim maps to a deterministic pillar (`F1`–`F5`) or layer (`layer:<name>`).

---

## Tier model

```
Tier 1 — Deterministic engine (source of truth)
  position_fundamentals_analyzer → F1-F5 pillar scores
  position_composite_engine → seven-layer composite, verdict, geometry
Tier 2 — Structured synthesis (this spec)
  position_thesis_packet.py (PURE) → bull_case / bear_case / open_questions + pillar_snapshot_hash
  POST /v1/signals/ai/explanations type=position_setup_read → Investment Read narrative
Tier 3 — Conversational research (POS-AI-3+, later)
```

---

## `position_thesis_packet` (POS-AI-1)

`build_position_thesis_packet(body: dict) -> PositionThesisPacket` — pure; input is a
position composite response body (`position_fundamentals.pillars[]` + `layers[]` + `verdict`).

### Output schema

```json
{
  "symbol": "AAPL",
  "verdict": "bullish",
  "bull_case": [{ "text": "...", "source": "F1", "confidence": "high|medium|low" }],
  "bear_case": [{ "text": "...", "source": "F4", "confidence": "..." }],
  "open_questions": [{ "text": "...", "source": "F4|layer:sector", "confidence": "..." }],
  "pillar_snapshot_hash": "<sha256[:16]>"
}
```

### Rules (deterministic)

- **Source tags:** every bullet cites `F1`–`F5` or `layer:<technical|sector|macro|news|geopolitical|internals|fundamentals>`.
- **Bull case:** pillar `score ≥ 62` (bullish) → bull bullet; bullish supporting layer → `layer:` bullet.
- **Bear case:** pillar `score ≤ 38` (bearish) → bear bullet; bearish supporting layer → `layer:` bullet. The **weakest pillar** always appears as a watch item even when neutral.
- **Open questions:** unavailable/unscored pillars; `low`/`unavailable` data-quality pillars; **value-trap watch** (F4 not bullish while F1+F2 bullish); and, when nothing contradicts the thesis, an explicit "what would invalidate this?" prompt.
- **Confidence:** `high` = high data quality and `|score−50| ≥ 20`; `medium` = high/medium data quality and `|score−50| ≥ 10`; else `low`.
- **Degraded/unavailable supporting layers** are skipped (never narrated as fact).
- **Insufficient data / no pillars:** empty cases + a single open question; hash still emitted.
- **Determinism:** fixed pillar (F1→F5) then layer order; bullets deduped by `(source, text)`; each section capped at 6.
- **`pillar_snapshot_hash`:** stable `sha256[:16]` over composite verdict + `parameter_version` + each pillar `(id, score, verdict)`. Used as the Tier 2 cache key so a Claude narration is reused until the underlying pillars change.

`deterministic_investment_read(packet)` weaves lead + top bull + top watch + open question into a non-advisory brief (free-tier / fallback), ending `Signal data only.`

---

## Investment Read (POS-AI-2)

`POST /v1/signals/ai/explanations` `type: "position_setup_read"` — paid users get a Claude
narration of the packet (system prompt enforces: no buy/sell/allocation, desk scope "Position",
cite pillar IDs, surface uncertainty); free users and any failure get `deterministic_investment_read`.
Response matches the existing `{ text, source, upgrade_available, cached, disclaimer }` contract.
