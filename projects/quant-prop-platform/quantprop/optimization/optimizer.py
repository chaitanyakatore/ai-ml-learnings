"""
Optimization

Responsibility:
- Optimizing strategy parameters (e.g. indicator lookbacks, SL/TP multipliers) using grid or random search.
- Conducting walk-forward testing to validate out-of-sample performance and reduce overfitting.
- Treating the backtest and evaluation engine strictly as read-only scoring functions.

Interface Boundaries:
- Inputs:
  * Strategy class.
  * Parameter search space (dict of lists/ranges).
  * Train/test split rules or walk-forward windows.
  * Target score metric (e.g. Profit Factor, Sharpe Ratio, Pass Probability).
- Outputs:
  * Best parameters (dict).
  * Out-of-sample backtest results.
  * Optimization run log showing performance across the parameter grid.

Core Constraints:
- Optimization must not modify the backtest engine; it treats it as a black box.
- All random search elements must support seeded, deterministic reproducibility.
"""

import itertools
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Callable, Optional
import polars as pl
from quantprop.backtest.backtester import BacktestEngine
from quantprop.evaluation.evaluation_engine import EvaluationEngine

class StrategyOptimizer:
    """
    Search engine for optimal and robust strategy configurations.
    
    Implements:
    - Grid Search: Exhaustively runs backtests over parameter grids and scores them.
    - Walk-Forward Validation: Rolling train (in-sample) and test (out-of-sample) segments
      to optimize parameters dynamically and measure true, un-overfitted performance.
    """
    def __init__(self, target_metric: str = "net_profit"):
        self.target_metric = target_metric

    def grid_search(
        self,
        strategy_class: type,
        param_grid: Dict[str, List[Any]],
        data: pl.LazyFrame,
        backtest_config: Optional[Dict[str, Any]] = None,
        scorer: Optional[Callable[[Dict[str, Any], Dict[str, Any]], float]] = None
    ) -> pl.DataFrame:
        """
        Run an exhaustive search over the parameter combination grid.
        
        Returns:
            A Polars DataFrame containing parameter combinations, scores, and metrics
            sorted by score descending (best configuration first).
        """
        config = backtest_config or {}
        initial_balance = config.get("initial_balance", 10000.0)
        risk_params = config.get("risk_params", {
            "stop_loss_pct": 0.02,
            "take_profit_pct": 0.04,
            "risk_percent": 0.01,
            "base_lot": 0.1
        })
        
        # Extract keys and values from param_grid
        keys = list(param_grid.keys())
        values = list(param_grid.values())
        
        # Generate Cartesian product combinations
        combos = list(itertools.product(*values))
        results_records = []
        
        for combo in combos:
            params = dict(zip(keys, combo))
            
            # Instantiate strategy
            try:
                strategy = strategy_class(
                    name=f"Opt_{strategy_class.__name__}",
                    risk_params=risk_params,
                    **params
                )
            except Exception as e:
                # Skip invalid parameter settings
                continue
                
            # Instantiate BacktestEngine
            engine = BacktestEngine(
                strategy=strategy,
                initial_balance=initial_balance,
                spread=config.get("spread", 0.0),
                commission=config.get("commission", 0.0),
                slippage=config.get("slippage", 0.0),
                contract_size=config.get("contract_size", 100000.0)
            )
            
            # Execute backtest
            try:
                results = engine.run(data)
                
                # Evaluate results
                eval_engine = EvaluationEngine({"starting_balance": initial_balance})
                verdict = eval_engine.evaluate(results["trade_log"], results["equity_curve"])
                eval_metrics = verdict.get("metrics", {})
                
                # Score the configuration
                if scorer is not None:
                    score = scorer(results, verdict)
                else:
                    # Default: Net Profit if no hard breach, else huge penalty
                    if verdict["breached"]:
                        score = -1e9
                    else:
                        score = eval_metrics.get("net_profit", 0.0)
                        
                record = {
                    **params,
                    "score": float(score),
                    "net_profit": float(eval_metrics.get("net_profit", 0.0)),
                    "win_rate": float(eval_metrics.get("win_rate", 0.0)),
                    "breached": bool(verdict["breached"])
                }
                results_records.append(record)
            except Exception as e:
                # Skip failed runs
                continue
                
        if not results_records:
            return pl.DataFrame(schema={**{k: pl.Float64 for k in keys}, "score": pl.Float64, "net_profit": pl.Float64, "win_rate": pl.Float64, "breached": pl.Boolean})
            
        df = pl.DataFrame(results_records)
        return df.sort("score", descending=True)

    def walk_forward_test(
        self,
        strategy_class: type,
        param_grid: Dict[str, List[Any]],
        data: pl.LazyFrame,
        train_days: int,
        test_days: int,
        backtest_config: Optional[Dict[str, Any]] = None,
        scorer: Optional[Callable[[Dict[str, Any], Dict[str, Any]], float]] = None
    ) -> Dict[str, Any]:
        """
        Runs rolling walk-forward validation over the data.
        
        For each segment:
        - Optimizes parameters on train_days (In-Sample).
        - Runs simulation with optimal parameters on subsequent test_days (Out-of-Sample).
        - Carries the ending balance of window N into window N+1 continuously.
        """
        config = backtest_config or {}
        initial_balance = config.get("initial_balance", 10000.0)
        
        # Collect data locally to partition by date
        df_full = data.collect().sort("timestamp")
        
        min_time = df_full["timestamp"].min()
        max_time = df_full["timestamp"].max()
        
        if min_time.tzinfo is None:
            min_time = min_time.replace(tzinfo=timezone.utc)
        if max_time.tzinfo is None:
            max_time = max_time.replace(tzinfo=timezone.utc)

        current_balance = initial_balance
        current_time = min_time
        
        oos_trade_logs = []
        oos_equity_curves = []
        
        while True:
            train_start = current_time
            train_end = train_start + timedelta(days=train_days)
            test_start = train_end
            test_end = test_start + timedelta(days=test_days)
            
            if test_start >= max_time:
                break
            if test_end > max_time:
                test_end = max_time
                
            # Slice LazyFrames for training and testing segments
            train_data = df_full.filter(
                (pl.col("timestamp") >= train_start) & (pl.col("timestamp") < train_end)
            ).lazy()
            
            test_data = df_full.filter(
                (pl.col("timestamp") >= test_start) & (pl.col("timestamp") < test_end)
            ).lazy()
            
            # Check if we have enough data points to optimize and backtest
            train_count = train_data.collect().height
            test_count = test_data.collect().height
            
            if train_count < 10 or test_count < 2:
                # Move window forward and continue
                current_time += timedelta(days=test_days)
                continue
                
            # 1. In-Sample Optimization
            # Pass current_balance as the starting reference for this optimization window
            train_config = {**config, "initial_balance": current_balance}
            opt_df = self.grid_search(
                strategy_class, 
                param_grid, 
                train_data, 
                backtest_config=train_config, 
                scorer=scorer
            )
            
            if len(opt_df) > 0:
                best_row = opt_df.row(0, named=True)
                best_params = {k: best_row[k] for k in param_grid.keys()}
            else:
                # Fallback to default (first permutation in the grid)
                best_params = {k: v[0] for k, v in param_grid.items()}
                
            # 2. Out-of-Sample Backtesting
            # Carry-forward the ending balance of the previous window
            test_config = {**config, "initial_balance": current_balance}
            
            strategy_oos = strategy_class(
                name=f"OOS_{strategy_class.__name__}",
                risk_params=config.get("risk_params", {}),
                **best_params
            )
            
            engine_oos = BacktestEngine(
                strategy=strategy_oos,
                initial_balance=current_balance,
                spread=config.get("spread", 0.0),
                commission=config.get("commission", 0.0),
                slippage=config.get("slippage", 0.0),
                contract_size=config.get("contract_size", 100000.0)
            )
            
            oos_res = engine_oos.run(test_data)
            
            # Save logs
            if len(oos_res["trade_log"]) > 0:
                oos_trade_logs.append(oos_res["trade_log"])
            if len(oos_res["equity_curve"]) > 0:
                oos_equity_curves.append(oos_res["equity_curve"])
                # Carry balance forward
                current_balance = oos_res["equity_curve"][-1, "balance"]
                
            # Roll time forward by test segment duration
            current_time += timedelta(days=test_days)
            
        # Combine rolling logs
        if oos_trade_logs:
            combined_trade_log = pl.concat(oos_trade_logs).sort("entry_time")
        else:
            combined_trade_log = pl.DataFrame(schema={
                "symbol": pl.String, "direction": pl.String, "lot_size": pl.Float64,
                "entry_time": pl.Datetime(time_unit="us", time_zone="UTC"), "entry_price": pl.Float64,
                "exit_time": pl.Datetime(time_unit="us", time_zone="UTC"), "exit_price": pl.Float64,
                "pnl": pl.Float64, "commissions": pl.Float64, "exit_reason": pl.String
            })
            
        if oos_equity_curves:
            combined_equity_curve = pl.concat(oos_equity_curves).sort("timestamp")
        else:
            combined_equity_curve = pl.DataFrame(schema={
                "timestamp": pl.Datetime(time_unit="us", time_zone="UTC"),
                "balance": pl.Float64, "equity": pl.Float64
            })
            
        return {
            "trade_log": combined_trade_log,
            "equity_curve": combined_equity_curve
        }
