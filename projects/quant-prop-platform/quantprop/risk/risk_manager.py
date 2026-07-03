"""
Risk Management

Responsibility:
- Intercepts strategy signals pre-execution and runs them through compliance checks.
- Enforces stop-loss validation, leverage verification, lot sizing, and hedging prohibitions.
- Dynamically tracks order history to implement the FundedFirm "base lot" logic per instrument.

Interface Boundaries:
- Inputs:
  * Proposed order details (symbol, direction, lot_size, sl_price, tp_price).
  * Current account state (balance, equity, daily_dd_limit_amount, open_positions).
- Outputs:
  * Decision object: (is_approved: bool, reason: str, adjusted_order: dict or None).

Core Constraints:
- No Hedging: Opposing BUY and SELL on the same symbol is prohibited (§7).
- Single Trade Loss Cap: Clustered trade loss must not exceed 40% of the daily drawdown limit (§5).
- Dynamic Base-Lot sizing: Tracks order history per instrument. Lot size must be between base_lot and 5x base_lot.
  Resets base_lot downward if a smaller trade lot is placed (§6).
- Stateful behavior: Must persist running state (e.g. minimum lot size) per instrument across trades.
"""

from typing import Dict, Any, Optional

class RiskManager:
    """
    Stateful risk and pre-trade rules validator.
    """
    def __init__(self):
        # Maps instrument symbol to the minimum lot size ever traded (the "base lot")
        self.base_lots: Dict[str, float] = {}

    def check_order(
        self,
        symbol: str,
        direction: str,
        lot_size: float,
        entry_price: float,
        sl_price: float,
        account_balance: float,
        account_equity: float,
        daily_dd_limit_amount: float,
        open_positions: list
    ) -> Dict[str, Any]:
        """
        Validate an incoming order against hard risk limits and dynamic base lot rules.
        
        Returns:
            A dictionary containing validation outcome:
            {
                "approved": bool,
                "reason": str,
                "adjusted_lot_size": float
            }
        """
        raise NotImplementedError("Scaffolded placeholder")

    def update_base_lot(self, symbol: str, executed_lot_size: float) -> None:
        """
        Call this when an order is successfully executed to update the base lot state.
        
        Per FundedFirm §6, base lot resets down if executed lot size is smaller.
        """
        raise NotImplementedError("Scaffolded placeholder")
