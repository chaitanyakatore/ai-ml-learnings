Add a new strategy module to the Strategy Layer.

Steps:
1. Ask the user for the strategy's hypothesis in plain language before writing any code.
2. Create the strategy module following the interface used by existing strategies in the
   Strategy Layer (check existing modules for the pattern; if none exist yet, propose one
   consistent with `.agents/rules/architecture-principles.md`).
3. Require the strategy to define: entry rule, exit rule, stop loss, take profit, risk % per
   trade, and position sizing method. Do not default any of these silently — if the user
   hasn't specified one, ask.
4. Store the stated hypothesis in the module (docstring or config field).
5. Run the strategy through the Backtest Engine over the available historical data for its
   target instrument(s).
6. Run the resulting trade log through the Evaluation/Rules Engine
   (`.agents/rules/fundedfirm-evaluation-rules.md`) and report the pass/fail verdict and any
   flags (single-trade dependency, gambling behavior, Martingale, etc.) to the user.
7. Report performance stats via Analytics & Reporting (win rate, expectancy, max drawdown,
   trade count) alongside the verdict.
8. Do not declare the strategy "successful" — only report the results. Success is judged
   against `PROJECT_OVERVIEW.md` §10 by the user, not assumed by the agent.
