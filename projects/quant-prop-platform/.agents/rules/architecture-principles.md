---
trigger: always_on
---

# Architecture & Engineering Principles

## Module boundaries

Keep these as independent modules with clean, testable interfaces. No module should reach
into another's internals.

1. **Data Layer** — downloads, stores, and serves historical market data (Forex, Gold,
   Indices, Oil, Crypto). Owns caching/storage format. Nothing else touches raw data files
   directly — everything goes through this layer's API.
2. **Feature Engineering** — computes technical indicators/features from data-layer output.
   Pure functions where possible: same input data → same output features, no hidden state.
3. **Strategy Layer** — modular, pluggable strategy definitions. Each strategy declares its
   hypothesis, entry/exit rules, and required risk parameters (see
   `fundedfirm-evaluation-rules.md` §9). A strategy should be swappable without touching the
   backtest engine.
4. **Risk Management** — position sizing, pre-trade checks (no hedging, single-trade-loss
   cap, no undefined risk). Sits between strategy signals and the backtest/execution engine.
   Note: FundedFirm's lot-size cap (`fundedfirm-evaluation-rules.md` §6) is **stateful and
   dynamic** — the "base lot" per instrument can reset down over the account's history. This
   module needs to track that running state per instrument, not just apply a static formula.
5. **Backtest Engine** — simulates strategy + risk management over historical data with
   realistic costs (spread, commission, slippage, floating equity). Deterministic: same data
   + same config → same result, always.
6. **Evaluation/Rules Engine** — takes a completed backtest's trade log and applies a prop
   firm's rule set (FundedFirm first) to produce a verdict. **Rule sets must be
   pluggable/configurable** — this module should not hardcode FundedFirm-only logic in a way
   that blocks adding another firm's rules later. Keep two clearly separated sub-components:
   a **hard-rules checker** (deterministic breach/pass conditions, e.g. drawdown limits) and
   a **compliance heuristics checker** (discretionary flags like the forbidden-practices list
   in `fundedfirm-evaluation-rules.md` §9) — never let a heuristic flag silently behave like a
   hard fail, and never let a hard breach get downgraded to "just a flag."
7. **Optimization** — parameter search / walk-forward testing over the backtest engine.
   Should treat the backtest engine as a black-box scoring function it queries, not something
   it modifies.
8. **ML Research** — trade filtering/selection models. Consumes strategy signals + features,
   does not replace the strategy layer's core logic in v1 (see AGENTS.md §"No black boxes").
9. **Analytics & Reporting** — performance stats, drawdown curves, evaluation summaries,
   trade journal. Read-only consumer of backtest/evaluation output.

## Principles (apply to every module)

- **Modularity** — a change to one module (e.g. adding an instrument, or a new prop-firm
  rule set) should not require changes to unrelated modules.
- **Reproducibility** — no unseeded randomness anywhere in the data → backtest → evaluation
  path. If randomness is needed (e.g. ML training), seed it and log the seed.
- **Extensibility** — new indicators, strategies, instruments, and rule sets are additions,
  not edits to core engine code. Prefer registry/plugin patterns over long if/elif chains for
  strategy or rule-set selection.
- **Accuracy over speed** — when there's a tradeoff between backtest speed and simulation
  realism (costs, slippage, equity curve accuracy), choose realism. Speed optimizations are
  welcome as long as they don't change results.
- **Research first** — the platform's job is to test hypotheses against data, not to search
  blindly for whatever historically "worked" (which risks overfitting). Strategy modules
  should make their hypothesis explicit and testable, not just emit a signal.

## Config over hardcoding

Prop-firm rules (profit target %, drawdown %, trading day minimums, etc.) should live in
configuration, not be hardcoded into the evaluation engine, so that a second firm's rule set
can be added as a new config + minimal adapter code rather than a rewrite.