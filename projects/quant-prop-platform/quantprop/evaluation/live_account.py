import polars as pl
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

class LiveAccountSimulator:
    """
    Simulates the payout lifecycle of a live funded prop-firm account.
    
    Manages:
    - Weekly, biweekly, or monthly payout review calendars.
    - 1.0% net profit payout threshold checks.
    - Trader profit splits (60% for weekly, 80% for biweekly, 100% for monthly).
    - Account balance resets after withdrawals, showing how withdrawals reduce
      the buffer to the overall drawdown floor (which stays fixed).
    - Daily and overall drawdown enforcement on the adjusted equity curve.
    """
    def __init__(
        self,
        starting_balance: float = 10000.0,
        payout_schedule: str = "biweekly",
        profit_share_pct: Optional[float] = None
    ):
        self.starting_balance = starting_balance
        self.payout_schedule = payout_schedule.lower()
        
        # Default splits per schedule if not specified
        if profit_share_pct is not None:
            self.profit_share_pct = profit_share_pct
        else:
            if self.payout_schedule == "weekly":
                self.profit_share_pct = 0.60
            elif self.payout_schedule == "biweekly":
                self.profit_share_pct = 0.80
            else: # monthly
                self.profit_share_pct = 1.00

    def simulate_payouts(self, trade_log: pl.DataFrame, equity_curve: pl.DataFrame) -> Dict[str, Any]:
        """
        Simulate live account execution, processing withdrawals and drawdown breaches.
        
        Args:
            trade_log: DataFrame of closed trades.
            equity_curve: DataFrame of timestamp, balance, and equity.
            
        Returns:
            Dict containing payout records, breach details, and adjusted equity curve.
        """
        if len(equity_curve) == 0:
            return {
                "breached": False,
                "breach_time": None,
                "breach_reason": "",
                "payouts": [],
                "total_trader_earnings": 0.0,
                "adjusted_equity_curve": pl.DataFrame(schema=equity_curve.schema)
            }
            
        curve_dicts = equity_curve.to_dicts()
        start_time = curve_dicts[0]["timestamp"]
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
            
        start_date = start_time.date()
        
        # Determine the first review Wednesday (at least 7 days after starting date)
        # weekday() returns 0 for Monday, 2 for Wednesday, etc.
        days_to_first_wed = (2 - start_date.weekday()) % 7
        first_wed = start_date + timedelta(days=days_to_first_wed)
        first_review_date = first_wed + timedelta(days=7) # Second Wednesday
        
        # Setup next review date based on schedule
        if self.payout_schedule == "weekly":
            next_review_date = first_review_date
        elif self.payout_schedule == "biweekly":
            next_review_date = first_review_date
        else: # monthly
            next_review_date = start_date + timedelta(days=30)
            
        cumulative_withdrawn = 0.0
        last_payout_ref_balance = self.starting_balance
        payouts_log = []
        
        # Track daily drawdown variables on the adjusted curve (10:00 PM UTC reset)
        prev_shifted_date = None
        day_ref_value = self.starting_balance
        daily_dd_limit_amount = self.starting_balance * 0.03
        overall_dd_floor = self.starting_balance * 0.94
        
        breached = False
        breach_reason = ""
        breach_time = None
        
        adjusted_curve_records = []
        
        for row in curve_dicts:
            ts = row["timestamp"]
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
                
            curr_date = ts.date()
            
            # 1. Apply cumulative withdrawals to current row values
            adj_balance = row["balance"] - cumulative_withdrawn
            adj_equity = row["equity"] - cumulative_withdrawn
            
            # 2. Enforce Drawdown rules on adjusted equity curve
            # Shift timestamp by +2 hours for daily drawdown boundaries (10 PM UTC reset)
            shifted_dt = ts + timedelta(hours=2)
            current_shifted_date = shifted_dt.date()
            
            if prev_shifted_date is None or current_shifted_date != prev_shifted_date:
                day_ref_value = max(adj_balance, adj_equity)
                daily_dd_limit_amount = day_ref_value * 0.03
                prev_shifted_date = current_shifted_date
                
            daily_dd_floor = day_ref_value - daily_dd_limit_amount
            
            # Check breaches
            if adj_equity < daily_dd_floor:
                breached = True
                breach_reason = "daily_drawdown_breach"
                breach_time = ts
            elif adj_equity < overall_dd_floor or adj_balance < overall_dd_floor:
                breached = True
                breach_reason = "overall_drawdown_breach"
                breach_time = ts
                
            if breached:
                # Terminate account, record final state, and exit loop
                adjusted_curve_records.append({
                    "timestamp": ts,
                    "balance": adj_balance,
                    "equity": adj_equity
                })
                break
                
            # 3. Check for Payout review triggers
            # Trigger review on or after the review date
            if curr_date >= next_review_date:
                # Calculate profit relative to the last payout reference balance
                net_profit = adj_balance - last_payout_ref_balance
                threshold = 0.01 * self.starting_balance # 1% net profit threshold
                
                if net_profit >= threshold:
                    trader_share = net_profit * self.profit_share_pct
                    firm_share = net_profit * (1.0 - self.profit_share_pct)
                    
                    payout_event = {
                        "timestamp": ts,
                        "net_profit": net_profit,
                        "trader_payout": trader_share,
                        "firm_payout": firm_share,
                        "balance_before": adj_balance,
                        "balance_after": adj_balance - net_profit
                    }
                    payouts_log.append(payout_event)
                    
                    # Update parameters and apply reset
                    cumulative_withdrawn += net_profit
                    adj_balance -= net_profit
                    adj_equity -= net_profit
                    last_payout_ref_balance = adj_balance
                    
                # Setup next review date
                if self.payout_schedule == "weekly":
                    next_review_date = curr_date + timedelta(days=7)
                elif self.payout_schedule == "biweekly":
                    next_review_date = curr_date + timedelta(days=14)
                else: # monthly
                    next_review_date = curr_date + timedelta(days=30)
                    
            # Record adjusted row
            adjusted_curve_records.append({
                "timestamp": ts,
                "balance": adj_balance,
                "equity": adj_equity
            })
            
        total_trader_earnings = sum(p["trader_payout"] for p in payouts_log)
        
        return {
            "breached": breached,
            "breach_time": breach_time,
            "breach_reason": breach_reason,
            "payouts": payouts_log,
            "total_trader_earnings": total_trader_earnings,
            "adjusted_equity_curve": pl.DataFrame(adjusted_curve_records) if adjusted_curve_records else pl.DataFrame(schema=equity_curve.schema)
        }
