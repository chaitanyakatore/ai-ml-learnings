# Roadmap

Phased so Antigravity (and you) always know what's in scope right now. Don't start a later
phase's work before the current phase is solid — later phases depend on earlier ones being
trustworthy (e.g. optimization is meaningless if the backtest engine isn't accurate yet).

## Phase 0 — Foundations (before any strategy work)
- Lock tech stack (language, data storage format, dependency management) — see AGENTS.md
  "Tech stack assumptions"; needs a decision from you.
- Set up project scaffolding matching the module boundaries in
  `.agents/rules/architecture-principles.md`.
- Most rule ambiguities are now resolved in `fundedfirm-evaluation-rules.md` v2 (daily reset
  = 10pm UTC, dynamic base-lot sizing, two-step framework, 80%-rule is a review flag not an
  auto-fail). What's left is genuinely **DISCRETIONARY** per FundedFirm's own rulebook (§9
  forbidden-practices thresholds) — decide what conservative numeric thresholds this
  platform's own heuristics should use, and label them clearly as ours, not FundedFirm's.

## Phase 1 — Data + Backtest Engine
- Data Layer: download & store historical data for Forex, Metals, Indices, Energies, Digital
  currency, applying the correct per-asset-class leverage cap (§10).
- Backtest Engine: deterministic simulation with spread/commission/slippage/floating equity.
- Minimal Strategy Layer: enough to define one simple rule-based strategy end-to-end.
- Goal: a trustworthy, reproducible backtest of a trivial strategy, before anything else.

## Phase 2 — Risk Management + Evaluation/Rules Engine
- Risk Management module: pre-trade checks (no hedging §7, single-trade-loss cap §5, dynamic
  base-lot sizing §6, no undefined risk).
- Evaluation/Rules Engine implementing all of `fundedfirm-evaluation-rules.md`, including the
  two-step framework (§0) and the breach vs. review-flag distinction (§12) — don't conflate
  hard breaches with discretionary flags.
- Trade clustering merge logic (§4) implemented and unit-tested against constructed edge
  cases (trades exactly at the 3-minute boundary, the "anchors to first trade in cluster, not
  previous trade" rule, closed-but-still-clustered trades).
- Goal: any backtest's trade log can be run through the engine and get a correct FundedFirm
  step-pass/breach verdict, with review flags reported separately.

## Phase 3 — Feature Engineering + Strategy Expansion
- Feature Engineering module with a useful indicator library.
- Multiple strategy modules, each with a stated hypothesis.
- Performance Analysis / reporting.

## Phase 4 — Optimization + Robustness
- Walk-forward testing.
- Parameter optimization (treating the backtest engine as a black-box scoring function).
- Overfitting checks (train/test splits, multi-regime testing).

## Phase 5 — Machine Learning Research
- ML-based trade filtering/selection layered on top of rule-based strategies.
- Not a replacement for strategy logic — see AGENTS.md "No black boxes".

## Phase 6 — Portfolio Research
- Multi-strategy portfolio construction and optimization.

## Phase 7 — Live Funded Account & Payout Simulation
- Model the post-evaluation lifecycle: live funded account, same daily/overall drawdown
  rules (§2, §3), payout eligibility (1% net profit, §11), and payout schedule/profit-share
  simulation (monthly/biweekly/weekly, §11) — useful for a researcher to estimate expected
  take-home under different strategies, not just whether a strategy passes the challenge.
- Inactivity tracking (§0a) across both evaluation and live phases.

## Phase 8 — Live Execution (future)
- Broker/exchange API integration.
- Real-time risk enforcement mirroring the backtest rules engine exactly.

## Phase 9 — Platform Generalization (future)
- Configurable rule sets to support prop firms beyond FundedFirm.
- Cloud/distributed backtesting and optimization.
- Institutional-grade reporting.