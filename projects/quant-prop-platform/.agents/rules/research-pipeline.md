# Research Pipeline

Every strategy, and every feature built for the platform, should map onto a stage in this
pipeline. If a task doesn't fit anywhere in this pipeline, question whether it belongs in v1.

```
1. Hypothesis
2. Historical Data
3. Feature Engineering
4. Strategy Rules
5. Backtest
6. FundedFirm Validation
7. Performance Analysis
8. Optimization
9. Machine Learning Filter
10. Final Evaluation
```

## Stage details

1. **Hypothesis** — every strategy starts as a stated, falsifiable claim, e.g. *"Buying
   pullbacks during strong trends produces better risk-adjusted returns than buying
   breakouts."* Store this alongside the strategy code (docstring/config field) — a strategy
   without a stated hypothesis is incomplete (see AGENTS.md, Definition of Done).
2. **Historical Data** — pull from the Data Layer for the relevant instrument(s) and date
   range. Don't hand-pick favorable date ranges to fit the hypothesis.
3. **Feature Engineering** — compute whatever indicators/features the hypothesis needs, via
   the Feature Engineering module.
4. **Strategy Rules** — encode entry, exit, stop loss, take profit, position sizing as
   explicit, inspectable rules in the Strategy Layer. No undefined risk parameters.
5. **Backtest** — run through the Backtest Engine with realistic costs. This produces a trade
   log, not a verdict.
6. **FundedFirm Validation** — run the trade log through the Evaluation/Rules Engine
   (`fundedfirm-evaluation-rules.md`) to get a pass/fail verdict and any flags.
7. **Performance Analysis** — compute performance stats (win rate, expectancy, Sharpe/Sortino,
   max drawdown, drawdown duration, etc.) via Analytics & Reporting.
8. **Optimization** — if the strategy shows promise, run parameter search / walk-forward
   testing to check robustness — not to curve-fit. A strategy that only passes with one exact
   parameter set is a red flag for overfitting, not a win.
9. **Machine Learning Filter** — optionally apply an ML trade-selection filter on top of the
   rule-based strategy's signals (filtering only, not replacing the core logic).
10. **Final Evaluation** — check against the Success Criteria in `PROJECT_OVERVIEW.md` §10:
    passes every FundedFirm rule, profitable across multiple years, acceptable drawdown,
    performs across multiple market regimes, avoids overfitting, statistically significant
    trade count.

## Anti-patterns to avoid

- Skipping straight from an idea to a "backtest that made money" without a stated hypothesis
  or out-of-sample validation.
- Treating a single profitable backtest window as proof — always check across multiple
  years/regimes before calling a strategy successful.
- Optimizing parameters against the same data used to declare success (overfitting) — use
  walk-forward or train/test splits.
