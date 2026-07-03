"""
Simple Moving Average (SMA) Crossover Strategy.
"""

import polars as pl
from typing import Dict, Any
from quantprop.strategies.base_strategy import BaseStrategy
from quantprop.features.feature_engineering import add_sma

class SMACrossoverStrategy(BaseStrategy):
    """
    SMA Crossover strategy.
    
    Hypothesis:
        Buying when the fast SMA crosses above the slow SMA, and selling (exiting) 
        when it crosses below, captures medium-term trends and produces positive expectancy.
    """
    def __init__(
        self,
        name: str,
        risk_params: Dict[str, Any],
        fast_period: int = 5,
        slow_period: int = 20
    ):
        # BaseStrategy validates that risk_params contains:
        # stop_loss_pct, take_profit_pct, risk_percent, base_lot
        super().__init__(name, "SMA Crossover Trend Strategy", risk_params)
        self.fast_period = fast_period
        self.slow_period = slow_period

    def generate_signals(self, df: pl.LazyFrame) -> pl.LazyFrame:
        """
        Generate buy and exit signals based on SMA crossover.
        
        Outputs columns:
            - f"close_sma_{fast_period}"
            - f"close_sma_{slow_period}"
            - 'signal': 1 for BUY, -1 for EXIT, 0 for HOLD.
        """
        # Step 1: Compute indicators
        df_feats = add_sma(df, "close", self.fast_period)
        df_feats = add_sma(df_feats, "close", self.slow_period)
        
        fast_col = f"close_sma_{self.fast_period}"
        slow_col = f"close_sma_{self.slow_period}"
        
        # Step 2: Calculate shifted values for crossover logic
        # Shift(1) gives the previous row's value
        fast_prev = pl.col(fast_col).shift(1)
        slow_prev = pl.col(slow_col).shift(1)
        
        # Crossover checks
        buy_cond = (pl.col(fast_col) > pl.col(slow_col)) & (fast_prev <= slow_prev)
        exit_cond = (pl.col(fast_col) < pl.col(slow_col)) & (fast_prev >= slow_prev)
        
        # Create the signal column
        # 1 = BUY, -1 = EXIT (close long), 0 = HOLD/no action
        df_signals = df_feats.with_columns(
            pl.when(buy_cond)
            .then(1)
            .when(exit_cond)
            .then(-1)
            .otherwise(0)
            .alias("signal")
        )
        
        return df_signals
