"""
Evaluation Engine

Responsibility:
- Parsing completed backtest records (trade logs and equity curves) to evaluate compliance.
- Determining pass/fail/breach status for prop-firm challenges (e.g. FundedFirm Step 1 & 2).
- Implementing trade clustering merge rules and complex daily/overall drawdown checks.

Interface Boundaries:
- Inputs:
  * Trade Log DataFrame (realized trades, open/close timestamps, size, P/L).
  * Equity Curve DataFrame (time-series of balance and floating equity).
  * Rule Configuration (dict or config object with limits).
- Outputs:
  * EvaluationVerdict object (is_passed: bool, breach_detected: Optional[str], flags: List[str]).

Core Constraints:
- Strict segregation between hard breaches and review/compliance flags (§12):
  * Hard breaches (immediate, permanent fail): Daily drawdown (§2), Overall drawdown (§3), Hedging (§7).
  * Review flags (non-blocking but reported): Single trade dependency >= 80% (§8), Inactivity (§0a), Forbidden practices (§9).
- Exact simulation of daily drawdown reset at 10:00 PM UTC (§2).
- Trade clustering merge logic: trades on same symbol and direction within 3 minutes of first trade's open time count as a single trade (§4).
- Rule values must be configurable, not hardcoded.
"""

import polars as pl
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import collections

class EvaluationEngine:
    """
    Evaluator that applies prop-firm rules to backtest metrics.
    
    Implements FundedFirm rules:
    - Drawdown limits: Daily drawdown (3% starting balance/equity reset at 22:00 UTC) and Overall drawdown (6%).
    - Targets: Profit target (10% starting balance) across at least 3 distinct trading days.
    - Heuristics (Flags): Single trade dependency (>=80% profit) and inactivity (>=30 days).
    """
    def __init__(self, rule_config: Optional[Dict[str, Any]] = None):
        self.rule_config = rule_config or {}
        
        # Default config parameters
        self.starting_balance = self.rule_config.get("starting_balance", 10000.0)
        self.profit_target_pct = self.rule_config.get("profit_target_pct", 0.10)
        self.daily_dd_limit_pct = self.rule_config.get("daily_drawdown_pct", 0.03)
        self.overall_dd_limit_pct = self.rule_config.get("overall_drawdown_pct", 0.06)
        self.min_trading_days = self.rule_config.get("min_trading_days", 3)

    def evaluate(
        self, 
        trade_log: pl.DataFrame, 
        equity_curve: pl.DataFrame
    ) -> Dict[str, Any]:
        """
        Evaluate backtest output against rule configurations.
        
        Returns:
            A status dictionary outlining evaluation metrics and verdicts.
        """
        breached = False
        breach_reason: Optional[str] = None
        flags: List[str] = []
        
        # --- 1. Overall Drawdown Check (6% limit) ---
        overall_dd_floor = self.starting_balance * (1.0 - self.overall_dd_limit_pct)
        
        if len(equity_curve) > 0:
            min_equity = equity_curve["equity"].min()
            min_balance = equity_curve["balance"].min()
            
            if (min_equity is not None and min_equity < overall_dd_floor) or \
               (min_balance is not None and min_balance < overall_dd_floor):
                breached = True
                breach_reason = "overall_drawdown_breach"

        # --- 2. Daily Drawdown Check (3% limit, 10:00 PM UTC reset) ---
        if not breached and len(equity_curve) > 0:
            curve_rows = equity_curve.to_dicts()
            
            # Group rows by trading day (shift by +2 hours to map 22:00 UTC -> 00:00 UTC)
            days = collections.defaultdict(list)
            for row in curve_rows:
                ts = row["timestamp"]
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                shifted = ts + timedelta(hours=2)
                day_key = shifted.date()
                days[day_key].append(row)
                
            for day_key in sorted(days.keys()):
                day_rows = days[day_key]
                first_row = day_rows[0]
                
                # Reference value is the max of the starting balance/equity of this trading day
                day_ref_value = max(first_row["balance"], first_row["equity"])
                daily_dd_limit_amount = day_ref_value * self.daily_dd_limit_pct
                daily_dd_floor = day_ref_value - daily_dd_limit_amount
                
                for row in day_rows:
                    if row["equity"] < daily_dd_floor:
                        breached = True
                        breach_reason = "daily_drawdown_breach"
                        break
                if breached:
                    break

        # --- 3. Minimum Trading Days Check (3 days) ---
        unique_trading_days = set()
        if len(trade_log) > 0:
            for trade in trade_log.to_dicts():
                exit_time = trade["exit_time"]
                if exit_time.tzinfo is None:
                    exit_time = exit_time.replace(tzinfo=timezone.utc)
                shifted_exit = exit_time + timedelta(hours=2)
                unique_trading_days.add(shifted_exit.date())
                
        trading_days_count = len(unique_trading_days)
        is_min_days_met = trading_days_count >= self.min_trading_days

        # --- 4. Profit Target Check (10%) ---
        final_balance = self.starting_balance
        if len(equity_curve) > 0:
            final_balance = equity_curve[-1, "balance"]
            
        net_profit = final_balance - self.starting_balance
        required_profit = self.starting_balance * self.profit_target_pct
        is_target_met = net_profit >= required_profit

        # --- 5. Review Heuristics (Flags) ---
        
        # 5a. Single Trade Dependency (80% concentration rule)
        clustered_trades = self.cluster_trades(trade_log)
        if len(clustered_trades) > 0:
            clustered_dicts = clustered_trades.to_dicts()
            winning_pnls = [t["pnl"] for t in clustered_dicts if t["pnl"] > 0]
            total_winning_profit = sum(winning_pnls)
            
            if total_winning_profit > 0:
                max_trade_profit = max(winning_pnls)
                concentration_ratio = max_trade_profit / total_winning_profit
                if concentration_ratio >= 0.80:
                    flags.append("single_trade_dependency")

        # 5b. Trading Inactivity (30 consecutive days)
        if len(trade_log) > 0:
            sorted_trades = sorted(trade_log.to_dicts(), key=lambda x: x["entry_time"])
            for j in range(1, len(sorted_trades)):
                prev_exit = sorted_trades[j-1]["exit_time"]
                curr_entry = sorted_trades[j]["entry_time"]
                if prev_exit.tzinfo is None:
                    prev_exit = prev_exit.replace(tzinfo=timezone.utc)
                if curr_entry.tzinfo is None:
                    curr_entry = curr_entry.replace(tzinfo=timezone.utc)
                    
                days_inactive = (curr_entry - prev_exit).days
                if days_inactive >= 30:
                    flags.append("inactive_account")
                    break

        passes_challenge = is_target_met and is_min_days_met and not breached

        # Compile metrics summary
        metrics = {
            "starting_balance": self.starting_balance,
            "final_balance": final_balance,
            "net_profit": net_profit,
            "profit_target_met": is_target_met,
            "trading_days_count": trading_days_count,
            "min_trading_days_met": is_min_days_met,
            "max_drawdown_breached": breached,
        }

        return {
            "passed": passes_challenge,
            "breached": breached,
            "breach_reason": breach_reason,
            "flags": flags,
            "metrics": metrics
        }

    def cluster_trades(self, trade_log: pl.DataFrame) -> pl.DataFrame:
        """
        Groups trades matching the 3-minute same-direction same-symbol clustering rules.
        
        Per §4: window anchors to the cluster's first trade.
        """
        if len(trade_log) == 0:
            return trade_log
            
        trades = trade_log.to_dicts()
        # Sort by entry_time
        trades.sort(key=lambda x: x["entry_time"])
        
        # Track active anchors per (symbol, direction) -> (anchor_time, cluster_id)
        anchors = {}
        cluster_counter = 0
        
        # Assign cluster_id
        for t in trades:
            key = (t["symbol"], t["direction"])
            t_entry = t["entry_time"]
            if t_entry.tzinfo is None:
                t_entry = t_entry.replace(tzinfo=timezone.utc)
                
            # Check if there is an active anchor within 3 minutes
            if key in anchors:
                anchor_time, cid = anchors[key]
                if (t_entry - anchor_time).total_seconds() <= 180.0:
                    t["cluster_id"] = cid
                    continue
                    
            # Start new cluster
            cluster_counter += 1
            anchors[key] = (t_entry, cluster_counter)
            t["cluster_id"] = cluster_counter

        # Merge trades by cluster_id
        clustered_groups = collections.defaultdict(list)
        for t in trades:
            clustered_groups[t["cluster_id"]].append(t)
            
        merged_records = []
        for cid, group in clustered_groups.items():
            first = group[0]
            total_lots = sum(x["lot_size"] for x in group)
            
            weighted_entry = sum(x["entry_price"] * x["lot_size"] for x in group) / total_lots if total_lots > 0 else first["entry_price"]
            weighted_exit = sum(x["exit_price"] * x["lot_size"] for x in group) / total_lots if total_lots > 0 else first["exit_price"]
            
            merged_records.append({
                "symbol": first["symbol"],
                "direction": first["direction"],
                "lot_size": total_lots,
                "entry_time": min(x["entry_time"] for x in group),
                "entry_price": weighted_entry,
                "exit_time": max(x["exit_time"] for x in group),
                "exit_price": weighted_exit,
                "pnl": sum(x["pnl"] for x in group),
                "commissions": sum(x["commissions"] for x in group),
                "exit_reason": "|".join(sorted(list(set(x["exit_reason"] for x in group)))),
                "cluster_id": cid
            })
            
        return pl.DataFrame(merged_records)
