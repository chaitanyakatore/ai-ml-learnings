---
trigger: always_on
---

# FundedFirm Evaluation Rules — Implementation Spec

**v2 — updated from the official FundedFirm rulebook.** This supersedes the earlier draft;
prior `ASSUMPTION` flags are resolved below where the rulebook gave a definitive answer, and
narrowed where it's still genuinely discretionary/qualitative (flagged as **DISCRETIONARY**
— these can't be turned into hard pass/fail logic, only heuristic flags).

Every backtest result must be run through this engine to get a verdict. Note the pipeline is
now two-stage (§0) and continues past "evaluation" into a live/payout phase (§11) — this
platform's scope should model the full lifecycle, not just the challenge.

## 0. Evaluation Framework — Step 1 / Step 2

- FundedFirm evaluations have **two steps**. Each step independently requires: the profit
  target met (§1), minimum trading days met (§1), and no drawdown breach (§2, §3).
- Passing Step 1 promotes to Step 2; passing Step 2 promotes to a **live funded account**.
- **No maximum time limit** to complete either step — the simulator/evaluator must not
  impose an artificial "must pass within N days" constraint. Only the "no activity for 30
  consecutive days" rule (§0a) can end an evaluation due to time.

### 0a. Trading Inactivity
- If an account has **no trading activity for 30 consecutive days**, it is considered
  inactive and may be permanently disabled.
- This applies at both the evaluation and live-funded stages.

```
days_since_last_trade = current_date - last_trade_close_date
if days_since_last_trade >= 30:
    FLAG("inactive_account")  # eligible for disable
```

## 1. Profit Target & Minimum Trading Days

- Profit target: **10%** of the step's starting balance, per step (Step 1 and Step 2 each
  require their own 10% from their own starting balance).
- Minimum trading days: **3 separate trading days**, per step — a day counts only if at
  least one trade was opened and closed on it. Prevents the target being hit via 1-2 trades.

```
is_min_days_met = count(distinct trading_days_with_closed_trades_this_step) >= 3
is_target_met = step_current_balance >= step_starting_balance * 1.10
passes_profit_target = is_target_met AND is_min_days_met
```

## 2. Maximum Daily Drawdown — 3%

- Daily drawdown = 3% of the **higher of** starting balance or starting equity **at the
  start of the trading day**.
- **Daily reset time: 10:00 PM UTC** (confirmed — resolves the earlier open question about
  reset timezone).
- Fixed for the day; intraday profit does not raise the floor. Both floating and closed
  losses count.
- Breach = immediate, permanent account breach — access is revoked, not just a failed step.

```
day_reference_value = max(day_start_balance, day_start_equity)  # as of 22:00 UTC
daily_dd_limit_amount = day_reference_value * 0.03
daily_dd_floor = day_reference_value - daily_dd_limit_amount
# checked continuously, not just at day close:
if current_equity < daily_dd_floor:
    BREACH_IMMEDIATELY("daily_drawdown_breach")  # permanent, not just step-failure
```

Worked example from the rulebook: Day 1 balance/equity both $500 -> limit $15 -> equity must
stay above $485. Day 2 balance $510 + $10 floating profit -> starting equity $520 -> limit
$15.60 -> equity must stay above $504.40 for that day.

## 3. Maximum Overall Drawdown — 6%

- Fixed at 6% of the **initial account balance** for the life of the account — never moves.
- Example: start $500 -> max loss $30 -> equity/balance must always stay above $470.
- Both floating and closed losses count. Breach = immediate, permanent.

```
overall_dd_floor = initial_balance * 0.94
if current_equity < overall_dd_floor OR current_balance < overall_dd_floor:
    BREACH_IMMEDIATELY("overall_drawdown_breach")
```

## 4. Trade Clustering (definition used throughout this spec)

- Trades on the **same symbol**, **same direction**, opened within a **3-minute window**
  starting from the **first** trade's open time, are treated as a **single trade** for
  drawdown/loss/lot-size calculations.
- This applies **regardless of whether earlier trades in the window have already closed** —
  i.e. the merge is based on open time proximity, not open/closed status.
- Combined P/L (including floating) of the merged group is what counts against every limit
  below.

```
def cluster_trades(trades_same_symbol_direction):
    # sort by open_time; start a new cluster whenever a trade's open_time is
    # more than 180s after the *first* trade's open_time in the current cluster
    # (not the previous trade's open time -- window anchors to the cluster's first trade)
```

## 5. Single Trade Loss Cap — 40% of Daily Drawdown

- No single (clustered) trade's loss may exceed 40% of that day's drawdown limit amount.
- Example: $10,000 account, daily DD = 3% = $300 -> max single-trade loss = $120.
- This is fixed regardless of realized/unrealized status, and does not adjust with PnL.
- Pre-trade check: reject an order whose worst-case loss (to stop-loss, at position size)
  would exceed this cap.

```
max_single_trade_loss = daily_dd_limit_amount * 0.40
```

## 6. Position Sizing — Dynamic Base-Lot Rule (5x cap)

This replaces the earlier vague "max position size" requirement — it's a precise, **dynamic,
per-instrument** rule:

- For each traded pair/instrument, the **minimum lot size ever placed in that account's order
  history for that instrument** becomes the "base lot."
- Any position on that instrument must be between the base lot and **5x the base lot**.
- If a trade smaller than the current base lot is opened, the base lot **resets down** to
  that new smaller size, and the 5x ceiling recalculates from it.
- Evaluated independently per instrument (lot conventions differ, e.g. forex vs. digital
  currency).
- Clustered trades (§4) are treated as one trade for this check too.

```
def update_base_lot(instrument, new_trade_lot, current_base_lot):
    if current_base_lot is None or new_trade_lot < current_base_lot:
        return new_trade_lot  # base resets down
    return current_base_lot

def is_lot_size_valid(instrument, trade_lot, base_lot):
    return base_lot <= trade_lot <= base_lot * 5
```

Worked example: base lot 1.0 -> valid range 1-5 lots. If a 0.9-lot trade is then opened, base
resets to 0.9 -> valid range becomes 0.9-4.5 lots going forward.

## 7. No Hedging

- No simultaneous BUY and SELL positions on the same instrument, even at different price
  levels ("conflicted trade bias"). Pre-trade check: reject if an opposite-side open position
  exists on the same symbol.

## 8. Single Trade Dependency (80% rule) — Review Flag, Not Auto-Fail

- **Important correction from the earlier draft:** this is explicitly **not** an automatic
  pass/fail condition. The rulebook states accounts where >=80% of total profit comes from
  one trade "may be reviewed," and FundedFirm's risk team "may" initiate a full account
  reset **at their discretion**.
- Model this as a **flag for manual/simulated review**, separate from the automatic breach
  conditions in §2/§3. Don't hard-fail a backtest on this alone — surface it clearly in the
  evaluation report instead.

```
concentration_ratio = largest_clustered_trade_profit / total_profit
if concentration_ratio >= 0.80:
    FLAG_FOR_REVIEW("single_trade_dependency")  # NOT an automatic fail
```

## 9. Forbidden Trading Practices — Heuristic Detection (DISCRETIONARY)

The rulebook lists these as prohibited, enforced at FundedFirm's **sole discretion** with no
fixed numeric thresholds given. The evaluation engine should implement these as **heuristic
detectors that produce warnings/flags in the simulation report**, not hard pass/fail
booleans — and the platform's docs/UI should be honest that real enforcement is judgment-
based, not something this simulator can perfectly predict.

| Practice | What to heuristically detect |
|---|---|
| Bulk trading / mass simultaneous execution | Many near-identical trades opened within seconds; splitting one position into many small ones |
| One-sided betting / directional bias abuse | Sustained one-direction-only entries regardless of market structure; aggressive averaging into losers |
| Tick scalping / latency exploitation | Very high frequency of extremely short-duration trades (seconds-scale holds) |
| Trade clustering / artificial exposure concentration | Simultaneous entries across highly correlated instruments, not just the same symbol (broader than §4's same-symbol merge rule) |
| Copy trading / mirroring / coordinated trading | Only relevant if the platform ever manages multiple accounts — near-identical timing/direction/sizing across accounts |
| Hedging abuse between accounts | Opposing positions across related accounts — same caveat as above |
| Gambling-style risk behavior | Overlaps with Martingale/aggressive recovery sizing — escalating position size after losses, concentrated exposure |

- **DISCRETIONARY:** no numeric thresholds are specified for "excessive," "aggressive," or
  "abnormal" in any of the above. If/when the platform needs firm thresholds (e.g. to auto-
  reject a strategy pre-evaluation rather than just flag it), those need to be set as
  configurable parameters and explicitly labeled as this platform's own conservative
  heuristic, not a documented FundedFirm rule.

## 10. Instruments & Leverage

| Asset Class | Leverage |
|---|---|
| Forex | 1:100 |
| Metals (precious metals, incl. Gold) | 1:100 |
| Indices | 1:100 |
| Energies (energy commodities, incl. Oil) | 1:100 |
| Digital currency | 1:50 |

Backtest/risk simulation must apply the correct leverage cap per instrument class — don't use
a single flat leverage assumption across all instruments.

## 11. Live Funded Account — Payout Rules

Once Step 1 and Step 2 are both passed, the account becomes a live funded account. This is a
distinct phase the platform should model separately from evaluation:

- **Payout eligibility:** minimum **1% net profit** on the live account required before any
  payout.
- **Payout schedule options** (selected at enrollment), with different profit-share splits:

| Schedule | Trader's profit share |
|---|---|
| Monthly | up to 100% |
| Biweekly | 80% |
| Weekly | 60% |

- Weekly/biweekly payouts are released every **Wednesday**, starting from the **second week**
  after the account was opened.
- The same daily (§2) and overall (§3) drawdown rules continue to apply on the live account —
  a breach still means immediate, permanent loss of access.

## 12. Evaluation Verdict Logic (updated)

**Immediate, permanent breach** (ends evaluation or live account access) at any point:
- Daily drawdown breached (§2), or
- Overall drawdown breached (§3), or
- Hedging detected (§7)

**Step pass** (Step 1 -> Step 2, or Step 2 -> live funded), evaluated at step end:
- Profit target met across >=3 trading days for this step (§1)

**Reported but non-blocking** (surfaced in the evaluation report, not auto-fail):
- Single trade dependency >=80% (§8) — flagged for review
- Any forbidden-practice heuristic flags (§9) — flagged, discretionary
- Inactivity >=30 days (§0a) — flagged as at-risk of disable

**Pre-trade rejected** (prevented before the order is placed, not part of post-hoc verdict):
- Single trade loss exceeding cap (§5)
- Lot size outside the dynamic base-lot range (§6)
- Hedging (§7, also a live breach condition if it somehow executes)