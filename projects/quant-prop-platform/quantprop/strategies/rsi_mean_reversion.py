"""
RSI Mean Reversion Trading Strategy.
"""

import polars as pl
from typing import Dict, Any
from quantprop.strategies.base_strategy import BaseStrategy
from quantprop.features.feature_engineering import add_rsi

class RSIMeanReversionStrategy(BaseStrategy):
    """
    RSI Mean Reversion strategy.
    
    Hypothesis:
        Buying when the 14-period RSI drops below 30 (oversold) during sideways markets,
        and selling when it rises above 70 (overbought), captures short-term mean-reversion trends.
    """
    def __init__(
        self,
        name: str,
        risk_params: Dict[str, Any],
        period: int = 14,
        oversold_threshold: float = 30.0,
        overbought_threshold: float = 70.0
    ):
        super().__init__(name, "RSI Mean Reversion Strategy", risk_params)
        self.period = period
        self.oversold_threshold = oversold_threshold
        self.overbought_threshold = overbought_threshold

    def generate_signals(self, df: pl.LazyFrame) -> pl.LazyFrame:
        """
        Generate buy and exit signals based on RSI thresholds.
        
        Outputs columns:
            - f"rsi_{period}"
            - 'signal': 1 for BUY, -1 for EXIT, 0 for HOLD.
        """
        df_feats = add_rsi(df, self.period)
        rsi_col = f"rsi_{self.period}"
        
        # Shift to check crossover boundary
        rsi_prev = pl.col(rsi_col).shift(1)
        
        # Crossover checks
        # Buy: RSI crosses below oversold_threshold (from above/equal to below)
        buy_cond = (pl.col(rsi_col) < self.oversold_threshold) & (rsi_prev >= self.oversold_threshold)
        
        # Exit: RSI crosses above overbought_threshold (from below/equal to above)
        exit_cond = (pl.col(rsi_col) > self.overbought_threshold) & (rsi_prev <= self.overbought_threshold)
        
        return df_feats.with_columns(
            pl.when(buy_cond)
            .then(1)
            .when(exit_cond)
            .then(-1)
            .otherwise(0)
            .alias("signal")
        )
