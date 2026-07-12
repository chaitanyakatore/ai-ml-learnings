from typing import Dict, Any, List
from quantprop.execution.base_broker import BaseExecutionBroker

class MockLiveBroker(BaseExecutionBroker):
    """
    In-memory paper trading simulation client.
    
    Tracks balance, floating equity, open positions, commission deductions,
    and fills trades dynamically based on incoming mock market prices.
    """
    def __init__(
        self,
        initial_balance: float = 10000.0,
        spread: float = 0.0,
        commission: float = 0.0,
        slippage: float = 0.0,
        contract_size: float = 100000.0
    ):
        self.balance = initial_balance
        self.equity = initial_balance
        
        self.spread = spread
        self.commission = commission
        self.slippage = slippage
        self.contract_size = contract_size
        
        self.open_positions: Dict[str, Dict[str, Any]] = {}
        self.current_prices: Dict[str, float] = {}
        self.order_id_counter = 1000

    def update_price(self, symbol: str, price: float) -> None:
        """
        Update the current market price for an instrument and recalculate floating equity.
        """
        self.current_prices[symbol] = price
        self.recalculate_equity()

    def recalculate_equity(self) -> None:
        """
        Calculate the current floating equity based on active position PnLs.
        """
        floating_pnl = 0.0
        for pos in self.open_positions.values():
            symbol = pos["symbol"]
            current_price = self.current_prices.get(symbol)
            
            if current_price is not None:
                dir_sign = 1 if pos["direction"] == "BUY" else -1
                pnl = (current_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
                floating_pnl += pnl
                
        self.equity = self.balance + floating_pnl

    def get_account_state(self) -> Dict[str, float]:
        """
        Fetch current account state.
        """
        return {
            "balance": self.balance,
            "equity": self.equity
        }

    def place_order(
        self,
        symbol: str,
        direction: str,
        lot_size: float,
        sl_price: float,
        tp_price: float
    ) -> Dict[str, Any]:
        """
        Submit a market order to the mock broker.
        """
        price = self.current_prices.get(symbol)
        if price is None:
            raise ValueError(f"No current price set for instrument: {symbol}")
            
        # Apply spread and slippage (slippage increases execution cost)
        if direction == "BUY":
            exec_price = price + self.spread + self.slippage
        else:
            exec_price = price - self.spread - self.slippage
            
        # Subtract commissions immediately from balance
        comm_cost = lot_size * self.commission
        self.balance -= comm_cost
        
        position_id = f"pos_{self.order_id_counter}"
        self.order_id_counter += 1
        
        pos = {
            "position_id": position_id,
            "symbol": symbol,
            "direction": direction,
            "lot_size": lot_size,
            "entry_price": exec_price,
            "sl_price": sl_price,
            "tp_price": tp_price,
            "commissions": comm_cost
        }
        self.open_positions[position_id] = pos
        self.recalculate_equity()
        
        return {
            "status": "FILLED",
            "order_id": position_id,
            "execution_price": exec_price
        }

    def close_position(self, position_id: str) -> Dict[str, Any]:
        """
        Close an active position.
        """
        pos = self.open_positions.get(position_id)
        if pos is None:
            raise ValueError(f"Position not found: {position_id}")
            
        symbol = pos["symbol"]
        price = self.current_prices.get(symbol)
        if price is None:
            raise ValueError(f"No current price set for instrument: {symbol}")
            
        # Apply spread & slippage on exit execution
        if pos["direction"] == "BUY":
            close_price = price - self.spread - self.slippage
        else:
            close_price = price + self.spread + self.slippage
            
        dir_sign = 1 if pos["direction"] == "BUY" else -1
        pnl = (close_price - pos["entry_price"]) * dir_sign * pos["lot_size"] * self.contract_size
        
        self.balance += pnl
        del self.open_positions[position_id]
        self.recalculate_equity()
        
        return {
            "status": "CLOSED",
            "position_id": position_id,
            "pnl": pnl
        }

    def get_open_positions(self) -> List[Dict[str, Any]]:
        """
        Fetch all active open positions.
        """
        return list(self.open_positions.values())
