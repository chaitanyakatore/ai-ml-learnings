from typing import Dict, Any, Optional

class RiskManager:
    """
    Stateful risk and pre-trade compliance checks engine.
    
    Implements FundedFirm rules:
    - Hedging prohibition (§7): No opposite positions on the same symbol.
    - Single trade loss cap (§5): Worst-case loss must not exceed 40% of the daily drawdown limit.
    - Dynamic base-lot sizing (§6): Lots must be between base_lot and 5x base_lot. Resets down if smaller.
    """
    def __init__(self):
        # Maps symbol to the minimum lot size ever executed (the base lot)
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
        open_positions: list,
        contract_size: float = 100000.0
    ) -> Dict[str, Any]:
        """
        Validate an incoming order proposal against hard risk rules.
        
        Returns:
            Dict containing validation outcome:
            {
                "approved": bool,
                "reason": str,
                "adjusted_lot_size": float
            }
        """
        # --- 1. Hedging Prohibition Check (§7) ---
        opposite_direction = "SELL" if direction == "BUY" else "BUY"
        for pos in open_positions:
            if pos.get("symbol") == symbol and pos.get("direction") == opposite_direction:
                return {
                    "approved": False,
                    "reason": f"Hedging prohibited: existing {opposite_direction} position on {symbol}.",
                    "adjusted_lot_size": lot_size
                }

        # --- 2. Single Trade Loss Cap Check (§5) ---
        worst_case_loss = abs(entry_price - sl_price) * lot_size * contract_size
        max_allowed_loss = daily_dd_limit_amount * 0.40
        if worst_case_loss > max_allowed_loss:
            return {
                "approved": False,
                "reason": (
                    f"Single trade loss cap exceeded: potential loss of {worst_case_loss:.2f} "
                    f"exceeds 40% of daily drawdown limit ({max_allowed_loss:.2f})."
                ),
                "adjusted_lot_size": lot_size
            }

        # --- 3. Dynamic Base-Lot sizing Check (§6) ---
        current_base = self.base_lots.get(symbol)
        if current_base is not None:
            max_allowed_lot = current_base * 5.0
            # If the trade is larger than 5x the current base, it is rejected
            if lot_size > max_allowed_lot:
                return {
                    "approved": False,
                    "reason": (
                        f"Position size violation: lot size {lot_size} exceeds 5x cap "
                        f"of current base lot {current_base} (max allowed: {max_allowed_lot})."
                    ),
                    "adjusted_lot_size": lot_size
                }
            # Note: lot_size < current_base is allowed because it resets the base lot down
            # which is handled when the trade is executed via update_base_lot.

        return {
            "approved": True,
            "reason": "",
            "adjusted_lot_size": lot_size
        }

    def update_base_lot(self, symbol: str, executed_lot_size: float) -> None:
        """
        Updates the minimum lot size (base lot) for a symbol upon execution.
        
        Per §6: if a trade smaller than current base lot is executed, base lot resets down.
        """
        current_base = self.base_lots.get(symbol)
        if current_base is None or executed_lot_size < current_base:
            self.base_lots[symbol] = executed_lot_size

