"""
Bollinger Bands Breakout Trading Strategy.
"""

import polars as pl
from typing import Dict, Any
from quantprop.strategies.base_strategy import BaseStrategy
from quantprop.features.feature_engineering import add_bollinger_bands

class BollingerBandsBreakoutStrategy(BaseStrategy):
    """
    Bollinger Bands Breakout Strategy.
    
    Hypothesis:
        Buying when the price closes above the upper Bollinger Band (20-period, 2-std dev)
        during high volatility captures momentum breakouts.
    """
    def __init__(
        self,
        name: str,
        risk_params: Dict[str, Any],
        period: int = 20,
        std_dev_multiplier: float = 2.0
    ):
        super().__init__(name, "Bollinger Bands Breakout Strategy", risk_params)
        self.period = period
        self.std_dev_multiplier = std_dev_multiplier

    def generate_signals(self, df: pl.LazyFrame) -> pl.LazyFrame:
        """
        Generate buy and exit signals based on Bollinger Bands.
        
        Outputs columns:
            - f"close_bb_middle_{period}"
            - f"close_bb_upper_{period}"
            - f"close_bb_lower_{period}"
            - 'signal': 1 for BUY, -1 for EXIT, 0 for HOLD.
        """
        df_feats = add_bollinger_bands(df, "close", self.period, self.std_dev_multiplier)
        
        middle_col = f"close_bb_middle_{self.period}"
        upper_col = f"close_bb_upper_{self.period}"
        
        close_prev = pl.col("close").shift(1)
        upper_prev = pl.col(upper_col).shift(1)
        middle_prev = pl.col(middle_col).shift(1)
        
        # Crossover checks
        # Buy: close price crosses above Upper Band
        buy_cond = (pl.col("close") > pl.col(upper_col)) & (close_prev <= upper_prev)
        
        # Exit: close price crosses below Middle Band (SMA)
        exit_cond = (pl.col("close") < pl.col(middle_col)) & (close_prev >= middle_prev)
        
        return df_feats.with_columns(
            pl.when(buy_cond)
            .then(1)
            .when(exit_cond)
            .then(-1)
            .otherwise(0)
            .alias("signal")
        )
