# STOCVEST — Monthly signal tuning playbook

**Last reviewed:** 2026-05-07 — playbook unchanged; landing, founding-member API, beta override, and HTTP audit infra are documented in [`docs/CONTEXT.md`](./CONTEXT.md) §1–§2 and [`docs/API_CONTRACTS.md`](./API_CONTRACTS.md).

Use with **`stocvest/config/signal_parameters.py`** (defaults), **Secrets Manager** secret `stocvest/signal-parameters`, **DynamoDB** `ParameterHistory`, and **`GET /v1/signals/analysis`**.

---

## Prerequisites

- **Terraform applied** so `ParameterHistory` exists and Lambdas have `DYNAMODB_PARAMETER_HISTORY_TABLE` and Secrets Manager read/write for `stocvest/signal-parameters*`.
- **Initial secret**: run `python scripts/init_signal_parameters.py` once per account/region (requires AWS credentials).
- **Analysis access** (one of):
  - HTTP header `X-Stocvest-Internal-Analysis` equal to env **`STOCVEST_INTERNAL_ANALYSIS_KEY`** (for scripted `lambda invoke` / internal tools), or
  - JWT **`sub`** listed in **`STOCVEST_ANALYSIS_ADMIN_SUBS`** (comma-separated), or
  - Cognito group **`signal-analytics-admin`**.

---

## Step 1 — Pull analysis (first Monday of the month)

Authenticated **GET** (recommended via API Gateway):

`GET /v1/signals/analysis?period=30d`

Or direct Lambda invoke with an event shaped like your API Gateway proxy (include the internal header if using `STOCVEST_INTERNAL_ANALYSIS_KEY`).

Inspect JSON: `by_rsi_bucket`, `by_vwap_position`, `by_orb_signal`, `by_volume_bucket`, `by_parameter_version`, `layer_accuracy`, `confluence_accuracy`, `total_signals`, `signals_with_outcomes`.

---

## Step 2 — Identify underperforming buckets

Heuristics (tune to your risk tolerance):

- Any bucket with **`accuracy_1h`** (or `accuracy_1d` when populated) materially below your baseline → revisit thresholds or weights for that dimension in `signal_parameters.py`.
- **`layer_accuracy.*_predicts_outcome`** low vs peers → consider lowering that layer’s composite weight when you wire parameters into scoring (future work).
- **`confluence_accuracy`** vs `n_confirming` → informs minimum confirming count for alerts (see `CompositeParameters.confluence_min_confirming`).

---

## Step 3 — Propose new weights (offline)

Example normalization from measured layer hit rates `layer_accuracy` (only illustrative — use your own windowing and significance tests):

```text
layer_accuracy = { "technical": 0.64, "news": 0.58, ... }
total = sum(layer_accuracy.values())
new_weights = { k: round(v / total, 2) for k, v in layer_accuracy.items() }
# Re-normalize composite weights to sum to 1.0 before applying.
```

Edit **`stocvest/config/signal_parameters.py`** or prepare a full JSON payload matching `SignalParameters` + nested objects.

---

## Step 4 — Publish parameters with audit trail

```bash
python scripts/update_parameters.py \
  --reason "Month 1 tuning: technical weight increased (64% accuracy), geo weight reduced (51% accuracy, near random)" \
  --json-path path/to/signal_parameters.json \
  --signal-count 847 \
  --accuracy-before 58.2
```

Omit `--json-path` to reload the current secret, bump the patch version, and re-save with only the `--reason` / counts updated (rare).

Each successful save:

- Updates **Secrets Manager** `stocvest/signal-parameters`.
- Appends a row to **`ParameterHistory`** (PK `version`).
- Clears the in-Lambda **5-minute** parameter cache.

---

## Step 5 — Monitor the next month

- New **`SignalRecord.parameter_version`** should match the active secret version after deploys.
- Re-run **`GET /v1/signals/analysis`** and compare accuracy buckets **by_parameter_version** (e.g. v1.0.1 vs v1.0.2).
- If accuracy regresses, publish a revert with an explicit `--reason` documenting the rollback.

---

## Related code

| Piece | Location |
|--------|-----------|
| Parameter schema | `stocvest/config/signal_parameters.py` |
| Load / save / cache | `stocvest/config/parameter_store.py` |
| History rows | `stocvest/data/parameter_history_store.py` |
| Snapshots on record | `stocvest/api/services/signal_snapshot_builders.py` |
| Analysis aggregation | `stocvest/api/services/signal_analysis.py` |
| HTTP route | `GET /v1/signals/analysis` in `stocvest/api/handlers/signals.py` |
