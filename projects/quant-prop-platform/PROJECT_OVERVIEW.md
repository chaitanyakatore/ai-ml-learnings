# QuantProp Research Platform — Project Overview

**Version:** 1.0
**Status:** Research & Development
**Author:** Chaitanya Katore

---

## 1. Problem Statement

Most retail traders attempt to pass proprietary trading firm ("prop firm") evaluation
challenges using discretionary trading or by copying signals from YouTube, Discord,
Telegram, or social media. These approaches are rarely statistically validated, rarely
risk-managed, and rarely tested objectively — so traders repeatedly fail evaluations due to
poor risk management, high drawdowns, overfitted strategies, emotional decision-making, and
a lack of systematic testing.

Professional quant desks don't work this way. They research, test, validate, and iterate on
strategies against historical data *before* risking capital. This project applies that same
discipline, but optimizes specifically for passing prop-firm evaluation rules — not just for
raw profitability.

## 2. Vision

Build a professional quantitative research platform that discovers, validates, optimizes,
and monitors systematic trading strategies that **consistently and repeatably** satisfy
prop-firm evaluation requirements. The platform should function like a research desk, not a
retail trading app.

## 3. Core Philosophy

**The objective is NOT to:**
- Maximize profit at any cost
- Predict every market move
- Build a black-box model that "forecasts" prices

**The objective IS to:**
- Find strategies with positive statistical expectancy that consistently pass prop-firm
  evaluations while respecting strict risk limits

The platform exists to answer one question — *"Would this strategy repeatedly pass the
funded challenge?"* — not the weaker question *"Did this strategy make money once?"*

## 4. Objectives

The platform should let a researcher:

1. Download and store historical market data efficiently
2. Engineer technical features
3. Build modular, rule-based trading strategies
4. Backtest strategies over historical data
5. Validate strategies against prop-firm evaluation rules
6. Optimize strategy parameters
7. Analyze strategy performance
8. Generate reports
9. Apply machine learning to improve trade selection
10. (Future) Support live execution

## 5. Current Target: FundedFirm Evaluations

Version 1 targets **FundedFirm** accounts specifically, across the account's **full
lifecycle**, not just the challenge:

```
Step 1 evaluation → Step 2 evaluation → Live funded account → Payouts
```

The system must model every FundedFirm rule precisely enough to simulate this whole
lifecycle and determine pass/fail/payout outcomes — see
[`.agents/rules/fundedfirm-evaluation-rules.md`](.agents/rules/fundedfirm-evaluation-rules.md)
for the full formalized rule set the engine must implement. Note that some rules (single
trade dependency, the "forbidden trading practices" list) are explicitly discretionary in
FundedFirm's own rulebook — the engine models them as flags/heuristics, not hard fail
conditions. See that doc for exactly which rules are hard breaches vs. review flags.

The architecture should keep the rule set pluggable so other prop firms can be added later
without touching the core engine (see Architecture Principles).

## 6. Supported Markets & Leverage (v1)

| Asset Class | Leverage |
|---|---|
| Forex | 1:100 |
| Metals (incl. Gold) | 1:100 |
| Indices | 1:100 |
| Energies (incl. Oil) | 1:100 |
| Digital currency | 1:50 |

Architecture must allow adding instruments later without redesign, and must apply the
correct per-instrument-class leverage cap rather than one flat assumption.

## 7. System Capabilities

- Historical backtesting
- Walk-forward testing
- Strategy parameter optimization
- Risk simulation
- Performance analytics
- Evaluation simulation (pass/fail against firm rules)
- Machine learning research
- Portfolio research
- Trade journaling

## 8. What This Platform Is NOT

- Not a signal provider
- Not a copy-trading platform
- Not a Martingale bot
- Not a high-frequency trading system
- Not a gambling system
- Not a black-box AI that predicts prices

This exists for **quantitative research**, full stop.

## 9. Research Workflow

Every strategy follows the same pipeline (formalized further in
[`.agents/rules/research-pipeline.md`](.agents/rules/research-pipeline.md)):

```
Hypothesis → Historical Data → Feature Engineering → Strategy Rules → Backtest
→ FundedFirm Validation → Performance Analysis → Optimization
→ Machine Learning Filter → Final Evaluation
```

Every strategy begins as a stated, falsifiable hypothesis — e.g. *"Buying pullbacks during
strong trends produces better risk-adjusted returns than buying breakouts."* The platform
exists to prove or reject hypotheses, not to search randomly for what "worked."

## 10. Success Criteria for a Strategy

A strategy is considered successful only if it:

- Passes every FundedFirm rule
- Remains profitable across multiple years of data
- Maintains acceptable drawdown
- Performs across multiple market conditions/regimes
- Avoids overfitting (out-of-sample / walk-forward validated)
- Has a statistically significant sample size of trades

## 11. Engineering Principles

- **Modularity** — data ingestion, strategies, risk management, backtesting, analytics, and
  evaluation rules are independent modules with clear interfaces.
- **Reproducibility** — the same data + config must always produce the same backtest result.
- **Extensibility** — new indicators, strategies, instruments, and prop-firm rule sets should
  be pluggable without touching the core engine.
- **Accuracy over speed** — realistic simulation (spread, commission, slippage, floating
  equity) takes priority over faster-but-unrealistic backtests.
- **Research first** — every trading idea is a testable hypothesis backed by data, not
  intuition.

Full detail in [`.agents/rules/architecture-principles.md`](.agents/rules/architecture-principles.md).

## 12. Long-Term Vision

Beyond v1, the platform should grow toward:

- Multi-strategy portfolios and portfolio optimization
- Reinforcement learning / AI-assisted strategy generation
- Live execution
- Cloud and distributed backtesting/optimization
- Institutional-grade reporting
- Configurable rule sets supporting multiple prop firms, not just FundedFirm

## 13. Document Map

| Document | Purpose |
|---|---|
| `PROJECT_OVERVIEW.md` (this file) | Human-facing vision, scope, and philosophy |
| `AGENTS.md` | Root operating instructions for Antigravity agents |
| `.agents/rules/fundedfirm-evaluation-rules.md` | Formal, implementation-ready rule engine spec |
| `.agents/rules/architecture-principles.md` | Module boundaries and engineering standards |
| `.agents/rules/research-pipeline.md` | The hypothesis-to-evaluation research workflow |
| `ROADMAP.md` | Phased build plan / milestones |