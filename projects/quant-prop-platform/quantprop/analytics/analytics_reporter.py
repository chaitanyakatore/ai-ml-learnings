import polars as pl
import math
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

class AnalyticsReporter:
    """
    Performance reporter and visualizer for strategy results.
    
    Computes standard quantitative metrics:
    - Win Rate, Profit Factor, Expectancy.
    - Peak-to-Trough Maximum Drawdown % and Duration.
    - Daily returns, annualized Sharpe Ratio, and annualized Sortino Ratio.
    """
    def __init__(self, trading_days_per_year: int = 252):
        self.trading_days_per_year = trading_days_per_year

    def calculate_metrics(self, trade_log: pl.DataFrame, equity_curve: pl.DataFrame) -> Dict[str, Any]:
        """
        Compute standard quantitative trading metrics.
        
        Args:
            trade_log: DataFrame of closed trades.
            equity_curve: DataFrame of timestamp, balance, and equity.
            
        Returns:
            Dict of calculated metrics.
        """
        metrics = {
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "expectancy": 0.0,
            "max_drawdown_pct": 0.0,
            "max_drawdown_duration_days": 0.0,
            "sharpe_ratio": 0.0,
            "sortino_ratio": 0.0,
            "total_profit": 0.0,
            "total_loss": 0.0,
            "net_profit": 0.0
        }
        
        # --- 1. Trade Log Metrics ---
        if len(trade_log) > 0:
            trades = trade_log.to_dicts()
            metrics["total_trades"] = len(trades)
            
            wins = [t["pnl"] for t in trades if t["pnl"] > 0]
            losses = [t["pnl"] for t in trades if t["pnl"] < 0]
            
            metrics["winning_trades"] = len(wins)
            metrics["losing_trades"] = len(losses)
            metrics["win_rate"] = len(wins) / len(trades) if len(trades) > 0 else 0.0
            
            total_profit = sum(wins)
            total_loss = sum(losses)
            metrics["total_profit"] = total_profit
            metrics["total_loss"] = total_loss
            metrics["net_profit"] = total_profit + total_loss # total_loss is negative
            
            if total_loss != 0:
                metrics["profit_factor"] = total_profit / abs(total_loss)
            else:
                metrics["profit_factor"] = float("inf") if total_profit > 0 else 0.0
                
            metrics["expectancy"] = trade_log["pnl"].mean() or 0.0

        # --- 2. Drawdown Metrics ---
        if len(equity_curve) > 0:
            peak = -float("inf")
            max_dd = 0.0
            
            # Track peak time to calculate duration
            peak_time = None
            max_dd_duration = timedelta(0)
            
            for row in equity_curve.to_dicts():
                eq = row["equity"]
                ts = row["timestamp"]
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                    
                if eq > peak:
                    peak = eq
                    peak_time = ts
                else:
                    dd = (peak - eq) / peak if peak > 0 else 0.0
                    if dd > max_dd:
                        max_dd = dd
                    
                    if peak_time is not None:
                        duration = ts - peak_time
                        if duration > max_dd_duration:
                            max_dd_duration = duration
                            
            metrics["max_drawdown_pct"] = max_dd
            metrics["max_drawdown_duration_days"] = max_dd_duration.total_seconds() / 86400.0

        # --- 3. Sharpe & Sortino Ratios ---
        if len(equity_curve) > 0:
            # Group by calendar date to calculate daily returns
            df_daily = equity_curve.with_columns(
                pl.col("timestamp").dt.date().alias("date")
            ).group_by("date").agg(
                pl.col("equity").last().alias("equity")
            ).sort("date")
            
            if len(df_daily) > 1:
                # Calculate percent returns
                returns = df_daily["equity"].pct_change().drop_nulls()
                
                mean_ret = returns.mean() or 0.0
                std_ret = returns.std() or 0.0
                
                annualization_factor = math.sqrt(self.trading_days_per_year)
                
                if std_ret > 0:
                    metrics["sharpe_ratio"] = annualization_factor * (mean_ret / std_ret)
                else:
                    metrics["sharpe_ratio"] = 0.0
                    
                # Sortino calculation (downside deviation only)
                downside_returns = returns.filter(returns < 0)
                if len(downside_returns) > 0:
                    downside_std = math.sqrt((downside_returns ** 2).mean())
                    if downside_std > 0:
                        metrics["sortino_ratio"] = annualization_factor * (mean_ret / downside_std)
                    else:
                        metrics["sortino_ratio"] = 0.0
                else:
                    metrics["sortino_ratio"] = float("inf") if mean_ret > 0 else 0.0

        return metrics

    def generate_report(self, metrics: Dict[str, Any], evaluation_verdict: Dict[str, Any]) -> str:
        """
        Generate a comprehensive markdown report for the user.
        """
        status_symbol = "✅ PASS" if evaluation_verdict["passed"] else "❌ BREACH/FAIL"
        breached_msg = f"**Breach Reason:** `{evaluation_verdict['breach_reason']}`" if evaluation_verdict["breached"] else ""
        flags_msg = f"**Compliance Flags:** `{', '.join(evaluation_verdict['flags'])}`" if evaluation_verdict["flags"] else "**Compliance Flags:** None"
        
        eval_metrics = evaluation_verdict.get("metrics", {})
        starting_balance = eval_metrics.get("starting_balance", 10000.0)
        profit_target_pct = eval_metrics.get("profit_target_pct", 0.10)
        min_trading_days = eval_metrics.get("min_trading_days", 3)
        daily_dd_limit_pct = eval_metrics.get("daily_drawdown_pct", 0.03)
        overall_dd_limit_pct = eval_metrics.get("overall_drawdown_pct", 0.06)

        report = f"""# QuantProp Backtest Performance Report

## 1. Challenge Verdict: {status_symbol}
{breached_msg}
{flags_msg}

---

## 2. Quantitative Performance Metrics

| Metric | Value |
|---|---|
| **Net Profit** | ${metrics['net_profit']:.2f} |
| **Gross Profit** | ${metrics['total_profit']:.2f} |
| **Gross Loss** | ${metrics['total_loss']:.2f} |
| **Total Trades** | {metrics['total_trades']} |
| **Winning Trades** | {metrics['winning_trades']} |
| **Losing Trades** | {metrics['losing_trades']} |
| **Win Rate** | {metrics['win_rate'] * 100.0:.2f}% |
| **Profit Factor** | {metrics['profit_factor']:.2f} |
| **Trade Expectancy** | ${metrics['expectancy']:.2f} |
| **Max Drawdown %** | {metrics['max_drawdown_pct'] * 100.0:.2f}% |
| **Max Drawdown Duration** | {metrics['max_drawdown_duration_days']:.2f} days |
| **Annualized Sharpe Ratio** | {metrics['sharpe_ratio']:.2f} |
| **Annualized Sortino Ratio** | {metrics['sortino_ratio']:.2f} |

---

## 3. Prop-Firm Rule Validation Checklist

| Rule Check | Status | Value | Target |
|---|---|---|---|
| **Step Profit Target** | {"Passed" if eval_metrics.get('profit_target_met') else "Failed"} | ${eval_metrics.get('net_profit', 0.0):.2f} | {profit_target_pct * 100.0:.1f}% (${starting_balance * profit_target_pct:.2f}) |
| **Minimum Trading Days** | {"Passed" if eval_metrics.get('min_trading_days_met') else "Failed"} | {eval_metrics.get('trading_days_count', 0)} days | >= {min_trading_days} days |
| **Daily Drawdown Breach** | {"Safe" if not evaluation_verdict['breached'] or evaluation_verdict['breach_reason'] != 'daily_drawdown_breach' else "BREACHED"} | - | < {daily_dd_limit_pct * 100.0:.1f}% |
| **Overall Drawdown Breach** | {"Safe" if not evaluation_verdict['breached'] or evaluation_verdict['breach_reason'] != 'overall_drawdown_breach' else "BREACHED"} | - | < {overall_dd_limit_pct * 100.0:.1f}% |

*Report generated on: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")}*
"""
        return report
