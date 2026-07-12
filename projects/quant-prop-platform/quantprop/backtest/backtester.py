"""
Backtest Engine

Responsibility:
- Executing a event-driven or vectorised historical simulation of trading strategy signals.
- Simulating executions realistically, applying spread, commission, and slippage.
- Calculating floating equity and balance updates at every step of the simulation.
- Running every signal through the RiskManager before pretending to execute it.

Interface Boundaries:
- Inputs:
  * Pluggable Strategy (BaseStrategy subclass).
  * RiskManager instance.
  * Historical OHLCV data.
  * Simulation config (initial balance, costs, slippage settings).
- Outputs:
  * Trade Log: A detailed chronological record of all orders and executed trades.
  * Equity Curve: Time-series of account balance and floating equity at each tick/bar.

Core Constraints:
- Reproducibility: Fully deterministic engine. No unseeded random variables.
- Realism: Must compute floating drawdown accurately (intraday/intrabar equity dips)
  since daily drawdown limits depend on floating equity (§2).
"""

import polars as pl
from datetime import datetime
from typing import Dict, Any, List, Optional
from quantprop.strategies.base_strategy import BaseStrategy
from quantprop.risk.risk_manager import RiskManager

class BacktestEngine:
    """
    Deterministic event-driven backtesting engine.
    
    Features:
    - Next-Bar-Open Execution: Signals generated at bar T are executed at the Open of bar T+1.
    - Transaction Costs: Simulates spread, commission per lot, and slippage.
    - Path-Dependent Equity Tracking: Updates floating equity and checks SL/TP at each bar.
    - End-of-Backtest Liquidation: Automatically closes any open positions at the final bar's close.
    """
    def __init__(
        self,
        strategy: BaseStrategy,
        risk_manager: Optional[RiskManager] = None,
        initial_balance: float = 10000.0,
        spread: float = 0.0,
        commission: float = 0.0,
        slippage: float = 0.0,
        contract_size: float = 100000.0,  # Default to standard Forex lot size (100k units)
        ml_filter: Optional[Any] = None,
        ml_filter_threshold: float = 0.55
    ):
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.initial_balance = initial_balance
        self.spread = spread
        self.commission = commission
        self.slippage = slippage
        self.contract_size = contract_size
        self.ml_filter = ml_filter
        self.ml_filter_threshold = ml_filter_threshold

    def run(self, data: pl.LazyFrame) -> Dict[str, Any]:
        """
        Execute the backtest simulation over the historical data.
        """
        from datetime import timedelta
        
        # Step 1: Generate strategy signals
        signals_lf = self.strategy.generate_signals(data)
        df = signals_lf.collect()
        
        # Initialize simulation variables
        balance = self.initial_balance
        equity = self.initial_balance
        
        open_positions: List[Dict[str, Any]] = []
        completed_trades: List[Dict[str, Any]] = []
        equity_curve: List[Dict[str, Any]] = []
        
        pending_order: Optional[Dict[str, Any]] = None
        
        # Track daily drawdown variables (10:00 PM UTC reset)
        prev_shifted_date = None
        daily_dd_limit_amount = self.initial_balance * 0.03
        day_ref_value = self.initial_balance
        overall_dd_floor = self.initial_balance * 0.94
        
        breached = False
        breach_reason = ""
        
        # Loop through each bar sequentially (event-driven execution)
        for i in range(len(df)):
            row = df.row(i, named=True)
            timestamp = row["timestamp"]
            open_p = row["open"]
            high_p = row["high"]
            low_p = row["low"]
            close_p = row["close"]
            sig = row.get("signal", 0)
            
            # --- 0. Daily Drawdown Reset Logic (10:00 PM UTC boundary) ---
            # Shift timestamp by +2 hours so that 22:00 UTC maps to 00:00 UTC of the next day.
            shifted_dt = timestamp + timedelta(hours=2)
            current_shifted_date = shifted_dt.date()
            if prev_shifted_date is None or current_shifted_date != prev_shifted_date:
                day_ref_value = max(balance, equity)
                daily_dd_limit_amount = day_ref_value * 0.03
                prev_shifted_date = current_shifted_date
                
            daily_dd_floor = day_ref_value - daily_dd_limit_amount
            
            # --- 1. Process Pending Order (if any) ---
            if pending_order is not None:
                # Execute order at current bar's Open price + costs
                direction = pending_order["direction"]
                lot_size = pending_order["lot_size"]
                
                # Apply spread & slippage (slippage always increases execution cost)
                if direction == "BUY":
                    exec_price = open_p + self.spread + self.slippage
                else:
                    exec_price = open_p - self.spread - self.slippage
                    
                # Apply commissions (taken immediately from balance)
                comm_cost = lot_size * self.commission
                balance -= comm_cost
                
                # Calculate SL/TP prices
                sl_pct = self.strategy.risk_params["stop_loss_pct"]
                tp_pct = self.strategy.risk_params["take_profit_pct"]
                
                if direction == "BUY":
                    sl_price = exec_price * (1.0 - sl_pct)
                    tp_price = exec_price * (1.0 + tp_pct)
                else:
                    sl_price = exec_price * (1.0 + sl_pct)
                    tp_price = exec_price * (1.0 - tp_pct)
                    
                open_positions.append({
                    "symbol": "MOCK",
                    "direction": direction,
                    "lot_size": lot_size,
                    "entry_price": exec_price,
                    "entry_time": timestamp,
                    "sl_price": sl_price,
                    "tp_price": tp_price,
                    "commissions": comm_cost
                })
                
                # Update RiskManager base lot on successful execution
                if self.risk_manager is not None:
                    self.risk_manager.update_base_lot("MOCK", lot_size)
                
                pending_order = None

            # --- 2. Check Stops (SL/TP) for Open Positions ---
            active_positions = []
            for pos in open_positions:
                dir_sign = 1 if pos["direction"] == "BUY" else -1
                is_closed = False
                close_price = 0.0
                close_reason = ""
                
                # Check Stop Loss
                if pos["direction"] == "BUY":
                    if low_p <= pos["sl_price"]:
                        is_closed = True
                        close_price = pos["sl_price"]
                        close_reason = "SL"
                else:
                    if high_p >= pos["sl_price"]:
                        is_closed = True
                        close_price = pos["sl_price"]
                        close_reason = "SL"
                        
                # Check Take Profit (If not already closed by SL)
                if not is_closed:
                    if pos["direction"] == "BUY":
                        if high_p >= pos["tp_price"]:
                            is_closed = True
                            close_price = pos["tp_price"]
                            close_reason = "TP"
                    else:
                        if low_p <= pos["tp_price"]:
                            is_closed = True
                            close_price = pos["tp_price"]
                            close_reason = "TP"
                            
                if is_closed:
                    # Apply closing costs
                    if pos["direction"] == "BUY":
                        final_close_price = close_price - self.spread - self.slippage
                    else:
                        final_close_price = close_price + self.spread + self.slippage
                        
                    # Calculate realized P/L
                    pnl = (final_close_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
                    balance += pnl
                    
                    completed_trades.append({
                        "symbol": pos["symbol"],
                        "direction": pos["direction"],
                        "lot_size": pos["lot_size"],
                        "entry_time": pos["entry_time"],
                        "entry_price": pos["entry_price"],
                        "exit_time": timestamp,
                        "exit_price": final_close_price,
                        "pnl": pnl,
                        "commissions": pos["commissions"],
                        "exit_reason": close_reason
                    })
                else:
                    active_positions.append(pos)
                    
            open_positions = active_positions

            # --- 3. Process Strategy Exit Signals ---
            # If strategy signals EXIT (-1), close open positions on next bar open
            if sig == -1 and open_positions:
                pass

            # --- 4. Calculate Floating P/L and Equity ---
            floating_pnl = 0.0
            for pos in open_positions:
                dir_sign = 1 if pos["direction"] == "BUY" else -1
                current_price = close_p
                # Current floating P/L based on current close price
                pnl = (current_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
                floating_pnl += pnl
                
            equity = balance + floating_pnl
            
            # --- 4a. Real-Time Drawdown Breach Enforcement ---
            if equity < daily_dd_floor:
                breached = True
                breach_reason = "daily_drawdown_breach"
            elif equity < overall_dd_floor or balance < overall_dd_floor:
                breached = True
                breach_reason = "overall_drawdown_breach"
                
            if breached:
                # Force liquidation of all positions immediately due to account violation
                for pos in open_positions:
                    dir_sign = 1 if pos["direction"] == "BUY" else -1
                    if pos["direction"] == "BUY":
                        final_close_price = close_p - self.spread - self.slippage
                    else:
                        final_close_price = close_p + self.spread + self.slippage
                    pnl = (final_close_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
                    balance += pnl
                    completed_trades.append({
                        "symbol": pos["symbol"],
                        "direction": pos["direction"],
                        "lot_size": pos["lot_size"],
                        "entry_time": pos["entry_time"],
                        "entry_price": pos["entry_price"],
                        "exit_time": timestamp,
                        "exit_price": final_close_price,
                        "pnl": pnl,
                        "commissions": pos["commissions"],
                        "exit_reason": f"BREACH_{breach_reason.upper()}"
                    })
                open_positions = []
                equity = balance
                equity_curve.append({
                    "timestamp": timestamp,
                    "balance": balance,
                    "equity": equity
                })
                break
            
            # Save equity curve point
            equity_curve.append({
                "timestamp": timestamp,
                "balance": balance,
                "equity": equity
            })

            # --- 5. Queue Strategy Signals (with Risk Checks) ---
            if sig == 1 and not open_positions and pending_order is None:
                lot_size = self.strategy.risk_params.get("base_lot", 0.1)
                
                # Check next bar open execution price for risk analysis
                if i + 1 < len(df):
                    next_open = df.row(i + 1, named=True)["open"]
                else:
                    next_open = close_p
                    
                exec_price_estimate = next_open + self.spread + self.slippage
                sl_price_estimate = exec_price_estimate * (1.0 - self.strategy.risk_params["stop_loss_pct"])
                
                approved = True
                
                # --- ML Filter Check ---
                if self.ml_filter is not None and getattr(self.ml_filter, "is_trained", False):
                    try:
                        trade_features = {}
                        for feat in self.ml_filter.feature_names:
                            val = row.get(feat)
                            if val is None:
                                approved = False
                                break
                            trade_features[feat] = float(val)
                        
                        if approved:
                            prob = self.ml_filter.should_execute(trade_features)
                            if prob < self.ml_filter_threshold:
                                approved = False
                    except Exception:
                        approved = False

                if approved and self.risk_manager is not None:
                    check = self.risk_manager.check_order(
                        symbol="MOCK",
                        direction="BUY",
                        lot_size=lot_size,
                        entry_price=exec_price_estimate,
                        sl_price=sl_price_estimate,
                        account_balance=balance,
                        account_equity=equity,
                        daily_dd_limit_amount=daily_dd_limit_amount,
                        open_positions=open_positions,
                        contract_size=self.contract_size
                    )
                    approved = check["approved"]
                    lot_size = check.get("adjusted_lot_size", lot_size)
                    
                if approved:
                    pending_order = {
                        "direction": "BUY",
                        "lot_size": lot_size
                    }
                    
            elif sig == -1 and open_positions:
                # Close all open positions at next bar's open price
                active_positions = []
                for pos in open_positions:
                    dir_sign = 1 if pos["direction"] == "BUY" else -1
                    # Execute close at next bar's open price
                    if i + 1 < len(df):
                        next_open = df.row(i + 1, named=True)["open"]
                        next_timestamp = df.row(i + 1, named=True)["timestamp"]
                    else:
                        next_open = close_p
                        next_timestamp = timestamp
                        
                    if pos["direction"] == "BUY":
                        final_close_price = next_open - self.spread - self.slippage
                    else:
                        final_close_price = next_open + self.spread + self.slippage
                        
                    pnl = (final_close_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
                    balance += pnl
                    
                    completed_trades.append({
                        "symbol": pos["symbol"],
                        "direction": pos["direction"],
                        "lot_size": pos["lot_size"],
                        "entry_time": pos["entry_time"],
                        "entry_price": pos["entry_price"],
                        "exit_time": next_timestamp,
                        "exit_price": final_close_price,
                        "pnl": pnl,
                        "commissions": pos["commissions"],
                        "exit_reason": "SIGNAL"
                    })
                open_positions = []

        # --- 6. End of Backtest Liquidation ---
        if open_positions and not breached:
            last_row = df.row(len(df) - 1, named=True)
            last_close = last_row["close"]
            last_time = last_row["timestamp"]
            
            for pos in open_positions:
                dir_sign = 1 if pos["direction"] == "BUY" else -1
                
                if pos["direction"] == "BUY":
                    final_close_price = last_close - self.spread - self.slippage
                else:
                    final_close_price = last_close + self.spread + self.slippage
                    
                pnl = (final_close_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
                balance += pnl
                
                completed_trades.append({
                    "symbol": pos["symbol"],
                    "direction": pos["direction"],
                    "lot_size": pos["lot_size"],
                    "entry_time": pos["entry_time"],
                    "entry_price": pos["entry_price"],
                    "exit_time": last_time,
                    "exit_price": final_close_price,
                    "pnl": pnl,
                    "commissions": pos["commissions"],
                    "exit_reason": "LIQUIDATION"
                })
            open_positions = []
            
            # Update final equity curve point
            if equity_curve:
                equity_curve[-1]["balance"] = balance
                equity_curve[-1]["equity"] = balance

        # Convert outputs to Polars DataFrames
        trade_log_df = pl.DataFrame(completed_trades) if completed_trades else pl.DataFrame(schema={
            "symbol": pl.String, "direction": pl.String, "lot_size": pl.Float64,
            "entry_time": pl.Datetime(time_unit="us", time_zone="UTC"), "entry_price": pl.Float64,
            "exit_time": pl.Datetime(time_unit="us", time_zone="UTC"), "exit_price": pl.Float64,
            "pnl": pl.Float64, "commissions": pl.Float64, "exit_reason": pl.String
        })
        
        equity_curve_df = pl.DataFrame(equity_curve) if equity_curve else pl.DataFrame(schema={
            "timestamp": pl.Datetime(time_unit="us", time_zone="UTC"),
            "balance": pl.Float64, "equity": pl.Float64
        })
        
        return {
            "trade_log": trade_log_df,
            "equity_curve": equity_curve_df,
            "breached": breached,
            "breach_reason": breach_reason
        }
