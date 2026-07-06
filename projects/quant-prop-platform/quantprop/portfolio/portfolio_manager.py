import polars as pl
import math
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from quantprop.backtest.backtester import BacktestEngine
from quantprop.evaluation.evaluation_engine import EvaluationEngine
from quantprop.strategies.base_strategy import BaseStrategy

class PortfolioManager:
    """
    Simulates and manages multi-strategy portfolios.
    
    Orchestrates backtests across multiple strategies, computes capital allocation
    weights (Equal Weight or Risk Parity), and merges individual trade logs
    and equity curves into a single consolidated portfolio result.
    """
    def __init__(
        self,
        strategies: List[BaseStrategy],
        allocation_method: str = "equal_weight",
        trading_days_per_year: int = 252
    ):
        self.strategies = strategies
        self.allocation_method = allocation_method
        self.trading_days_per_year = trading_days_per_year

    def calculate_weights(self, equity_curves: List[pl.DataFrame]) -> List[float]:
        """
        Calculate capital allocation weights for each strategy.
        
        Supports:
        - "equal_weight": equal allocation (1 / N).
        - "risk_parity": inverse volatility of daily returns weighting.
        """
        n = len(self.strategies)
        if n == 0:
            return []
            
        if self.allocation_method == "equal_weight":
            return [1.0 / n] * n
            
        elif self.allocation_method == "risk_parity":
            vols = []
            for curve in equity_curves:
                if len(curve) > 1:
                    # Compute daily returns
                    df_daily = curve.with_columns(
                        pl.col("timestamp").dt.date().alias("date")
                    ).group_by("date").agg(
                        pl.col("equity").last().alias("equity")
                    ).sort("date")
                    
                    if len(df_daily) > 1:
                        returns = df_daily["equity"].pct_change().drop_nulls()
                        std_dev = returns.std()
                        if std_dev is not None and std_dev > 0.0:
                            vols.append(std_dev)
                        else:
                            vols.append(0.01)  # Fallback standard deviation
                    else:
                        vols.append(0.01)
                else:
                    vols.append(0.01)
                    
            # Calculate inverse volatility weights
            inv_vols = [1.0 / vol for vol in vols]
            sum_inv_vols = sum(inv_vols)
            
            if sum_inv_vols > 0:
                return [w / sum_inv_vols for w in inv_vols]
            return [1.0 / n] * n
            
        else:
            raise ValueError(f"Unknown allocation method: {self.allocation_method}")

    def run_portfolio(
        self,
        data_list: List[pl.LazyFrame],
        backtest_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Orchestrate individual strategy backtests and merge results.
        
        Args:
            data_list: List of LazyFrames matching the strategies order.
            backtest_config: Core backtest settings.
            
        Returns:
            Dict containing:
            - trade_log: Consolidated portfolio trade log.
            - equity_curve: Consolidated portfolio equity curve.
            - weights: Computed capital weights.
            - evaluation_verdict: Combined prop-firm challenge verdict.
        """
        if len(data_list) != len(self.strategies):
            raise ValueError("Size of data_list must match number of strategies.")
            
        initial_balance = backtest_config.get("initial_balance", 10000.0)
        
        # 1. Execute individual backtests
        raw_trade_logs = []
        raw_equity_curves = []
        
        for i, strat in enumerate(self.strategies):
            engine = BacktestEngine(
                strategy=strat,
                initial_balance=initial_balance,
                spread=backtest_config.get("spread", 0.0),
                commission=backtest_config.get("commission", 0.0),
                slippage=backtest_config.get("slippage", 0.0),
                contract_size=backtest_config.get("contract_size", 100000.0)
            )
            res = engine.run(data_list[i])
            raw_trade_logs.append(res["trade_log"])
            raw_equity_curves.append(res["equity_curve"])
            
        # 2. Calculate allocation weights
        weights = self.calculate_weights(raw_equity_curves)
        
        # 3. Merge and scale trade logs
        weighted_trades = []
        for i, log in enumerate(raw_trade_logs):
            if len(log) > 0:
                w = weights[i]
                scaled_log = log.with_columns([
                    (pl.col("pnl") * w).alias("pnl"),
                    (pl.col("commissions") * w).alias("commissions"),
                    (pl.col("lot_size") * w).alias("lot_size"),
                    pl.lit(self.strategies[i].name).alias("strategy")
                ])
                weighted_trades.append(scaled_log)
                
        if weighted_trades:
            combined_trade_log = pl.concat(weighted_trades).sort("entry_time")
        else:
            combined_trade_log = pl.DataFrame(schema={
                "symbol": pl.String, "direction": pl.String, "lot_size": pl.Float64,
                "entry_time": pl.Datetime(time_unit="us", time_zone="UTC"), "entry_price": pl.Float64,
                "exit_time": pl.Datetime(time_unit="us", time_zone="UTC"), "exit_price": pl.Float64,
                "pnl": pl.Float64, "commissions": pl.Float64, "exit_reason": pl.String,
                "strategy": pl.String
            })

        # 4. Merge and align equity curves
        # Outer-join all strategy curves on timestamp, fill forward, and weight
        joined_df = None
        for i, curve in enumerate(raw_equity_curves):
            # Select and rename columns to uniquely identify strategy i
            sub_curve = curve.select([
                pl.col("timestamp"),
                pl.col("balance").alias(f"balance_{i}"),
                pl.col("equity").alias(f"equity_{i}")
            ])
            
            if joined_df is None:
                joined_df = sub_curve
            else:
                joined_df = joined_df.join(sub_curve, on="timestamp", how="full")
                
        if joined_df is not None:
            # Sort joined timestamps chronologically
            joined_df = joined_df.sort("timestamp")
            
            # Fill missing values forward (equity/balance does not change until a new tick on that curve)
            joined_df = joined_df.fill_null(strategy="forward")
            
            # Fill initial values before first tick with initial balance
            for i in range(len(self.strategies)):
                joined_df = joined_df.with_columns([
                    pl.col(f"balance_{i}").fill_null(initial_balance),
                    pl.col(f"equity_{i}").fill_null(initial_balance)
                ])
                
            # Compute portfolio balance and equity step-by-step
            # P_portfolio = Balance_initial + Sum( w_i * (P_i - Balance_initial) )
            balance_expr = pl.lit(initial_balance)
            equity_expr = pl.lit(initial_balance)
            
            for i in range(len(self.strategies)):
                w = weights[i]
                balance_expr = balance_expr + w * (pl.col(f"balance_{i}") - initial_balance)
                equity_expr = equity_expr + w * (pl.col(f"equity_{i}") - initial_balance)
                
            combined_equity_curve = joined_df.select([
                pl.col("timestamp"),
                balance_expr.alias("balance"),
                equity_expr.alias("equity")
            ])
        else:
            combined_equity_curve = pl.DataFrame(schema={
                "timestamp": pl.Datetime(time_unit="us", time_zone="UTC"),
                "balance": pl.Float64, "equity": pl.Float64
            })
            
        # 5. Evaluate combined portfolio against FundedFirm rules
        eval_engine = EvaluationEngine({"starting_balance": initial_balance})
        verdict = eval_engine.evaluate(combined_trade_log, combined_equity_curve)
        
        return {
            "trade_log": combined_trade_log,
            "equity_curve": combined_equity_curve,
            "weights": weights,
            "evaluation_verdict": verdict
        }
