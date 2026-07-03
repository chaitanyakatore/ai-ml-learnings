# AGENTS.md — QuantProp Research Platform

These are standing instructions for any agent (Antigravity, or otherwise) working in this
repository. Read this before starting any task. Full context lives in
[`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md); detailed rule specs live in `.agents/rules/`.

## What this project is

A quantitative research platform for discovering and validating systematic trading
strategies that must consistently pass **FundedFirm** prop-firm evaluation rules — not just
be profitable. Read `.agents/rules/fundedfirm-evaluation-rules.md` before writing any code
that touches risk, drawdown, or evaluation logic — getting this math wrong invalidates every
backtest built on top of it.

## Non-negotiables

1. **No undefined risk.** Every strategy must explicitly define entry, stop loss, take
   profit, risk %, lot size, and max position size before it can be backtested. Reject
   strategies that omit any of these rather than defaulting them silently.
2. **Simulate FundedFirm exactly**, per `.agents/rules/fundedfirm-evaluation-rules.md`. Do
   not approximate daily drawdown, overall drawdown, trade clustering, or Martingale
   detection — these have precise definitions and must be implemented exactly as specified.
3. **Reproducibility over cleverness.** Same data + same config must always produce the same
   backtest output. Avoid hidden randomness (e.g. unseeded RNGs) anywhere in the pipeline.
4. **Realism over speed.** Backtests must account for spread, commission, slippage, and
   floating equity. Don't optimize for backtest speed at the cost of simulation accuracy.
5. **Modularity.** Data ingestion, feature engineering, strategy logic, risk management,
   backtesting engine, evaluation/rules engine, and analytics/reporting are separate modules
   with clean interfaces. A new strategy or a new prop-firm rule set should be addable
   without modifying the core engine.
6. **No black boxes.** Every strategy must be inspectable — clear entry/exit logic, not an
   opaque model making unexplainable decisions. ML components are allowed for trade
   *filtering/selection*, not as the sole source of trading decisions in v1.

## Tech stack assumptions

Not yet locked in — the project doesn't specify a stack yet. Default to **Python** for the
research/backtesting core (pandas/numpy/polars for data, standard scientific stack for ML)
unless told otherwise, since that's the norm for quant research tooling and has the best
library support for time-series backtesting. Confirm with the user before committing to a
database, execution broker API, or web framework — those are open decisions.

## Before writing code

- Check `.agents/rules/research-pipeline.md` — new features should map to a stage in the
  pipeline (data → features → strategy → backtest → validation → analysis → optimization →
  ML filter).
- Check `ROADMAP.md` for what phase the project is in. Don't build Phase 3 (ML/optimization)
  functionality before Phase 1 (data + backtester) is solid — the rules engine correctness
  depends on having a trustworthy backtest engine first.
- If a task touches evaluation/risk logic, cite which rule in
  `.agents/rules/fundedfirm-evaluation-rules.md` it implements, in a code comment or PR
  description.

## Learning mode

The person building this is using it to learn quant research and software architecture
while building, not just to get finished code. Because of that:

- Before generating non-trivial code (a new module, a non-obvious algorithm, a design
  decision like a data structure or library choice), briefly explain **what** you're about
  to build and **why this approach**, in plain language, before writing it.
- When you introduce a concept from quant finance (drawdown, slippage, walk-forward testing,
  Sharpe ratio, etc.) or from software architecture (dependency injection, repository
  pattern, etc.), give a one-or-two sentence plain-English definition the first time it comes
  up in a session, rather than assuming familiarity.
- Prefer readable, well-commented code over clever or maximally-terse code, even if it's a
  few lines longer.
- For architectural decisions (module boundaries, tech stack pieces not already decided),
  pause and explain the tradeoffs rather than silently picking one and moving on — this is
  what Planning mode / Review-Driven autonomy is for.
- It's fine to still move fast on repetitive, already-decided work (boilerplate, tests
  matching an established pattern) without re-explaining every time.

## Available workflow

`.agents/workflows/teach-as-you-build.md` — invoke with `/teach-as-you-build` when you want a
deeper walkthrough of a specific piece (e.g. "explain the backtest engine you just wrote")
rather than the lighter default explanation above.

## Definition of done for any strategy module

A strategy is not "done" until it has: a stated hypothesis (docstring or config field),
defined risk parameters, a backtest run with realistic costs, and a pass/fail result from the
FundedFirm evaluation simulator. Code without a backtest, or a backtest without evaluation
against the rule engine, is incomplete.