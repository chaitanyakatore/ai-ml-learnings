from abc import ABC, abstractmethod
from typing import Dict, Any, List

class BaseExecutionBroker(ABC):
    """
    Abstract interface for broker API clients.
    
    Any live execution broker adapter (OANDA, MetaTrader 5, Interactive Brokers,
    or a paper-trading MockBroker) must subclass this and implement these methods.
    """
    @abstractmethod
    def get_account_state(self) -> Dict[str, float]:
        """
        Fetch current account state.
        
        Returns:
            Dict containing 'balance' and 'equity'.
        """
        pass

    @abstractmethod
    def place_order(
        self,
        symbol: str,
        direction: str,
        lot_size: float,
        sl_price: float,
        tp_price: float
    ) -> Dict[str, Any]:
        """
        Submit a market order to the broker.
        
        Args:
            symbol: Financial instrument (e.g. 'EURUSD').
            direction: 'BUY' or 'SELL'.
            lot_size: Trade size in lots.
            sl_price: Absolute price level for Stop Loss.
            tp_price: Absolute price level for Take Profit.
            
        Returns:
            Dict containing order details (e.g., 'order_id', 'execution_price', 'status').
        """
        pass

    @abstractmethod
    def close_position(self, position_id: str) -> Dict[str, Any]:
        """
        Close an active position.
        
        Returns:
            Dict containing details of the closed position.
        """
        pass

    @abstractmethod
    def get_open_positions(self) -> List[Dict[str, Any]]:
        """
        Fetch all active open positions.
        
        Returns:
            List of open position dictionaries.
        """
        pass
