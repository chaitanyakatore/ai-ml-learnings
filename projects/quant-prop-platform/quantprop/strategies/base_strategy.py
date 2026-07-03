"""
Strategy Layer

Responsibility:
- Defining the abstract base strategy structure.
- Forcing every concrete strategy to declare a falsifiable hypothesis and risk parameters.
- Generating raw execution signals based on historical features.

Interface Boundaries:
- Inputs: Polars DataFrame or LazyFrame with price and technical features.
- Outputs: Raw signal generators / dataframes indicating entry/exit conditions and price levels.

Core Constraints:
- No undefined risk. Every strategy must specify:
  * Entry rules
  * Stop Loss (SL)
  * Take Profit (TP)
  * Risk % per trade
  * Base lot size
  * Maximum position size
- Modularity: Swapping a strategy must not require any changes to the Backtest Engine.
"""

from abc import ABC, abstractmethod
import polars as pl
from typing import Dict, Any

class BaseStrategy(ABC):
    """
    Abstract base class for all strategies.
    """
    def __init__(self, name: str, hypothesis: str, risk_params: Dict[str, Any]):
        """
        Initialize the strategy.
        
        Args:
            name: Name of the strategy.
            hypothesis: A clear, falsifiable statement explaining why the strategy works.
            risk_params: Dictionary containing mandatory risk settings (stop loss, take profit, risk %, etc.)
        """
        self.name = name
        self.hypothesis = hypothesis
        self.risk_params = risk_params
        self._validate_risk_parameters()

    def _validate_risk_parameters(self):
        """
        Ensures all mandatory risk parameters are present.
        """
        required = {"stop_loss_pct", "take_profit_pct", "risk_percent", "base_lot"}
        missing = required - set(self.risk_params.keys())
        if missing:
            raise ValueError(f"Strategy {self.name} missing mandatory risk parameters: {missing}")

    @abstractmethod
    def generate_signals(self, df: pl.LazyFrame) -> pl.LazyFrame:
        """
        Generate raw entry and exit signals from features.
        
        Args:
            df: LazyFrame containing historical data and features.
            
        Returns:
            LazyFrame with signal columns (e.g. 'signal_type': BUY/SELL/EXIT).
        """
        pass
