from typing import Dict, Any, List, Optional
from quantprop.execution.base_broker import BaseExecutionBroker
from quantprop.risk.risk_manager import RiskManager
from quantprop.strategies.base_strategy import BaseStrategy

class ExecutionGateway:
    """
    Central gateway for real-time trade signals.
    
    Coordinates the strategy, risk controls, and broker API connection.
    Every trade signal is routed through the RiskManager for pre-trade compliance checks.
    If approved, it executes the trade on the broker and synchronizes risk state variables.
    """
    def __init__(
        self,
        strategy: BaseStrategy,
        risk_manager: RiskManager,
        broker: BaseExecutionBroker,
        daily_dd_limit_amount: float = 300.0,
        contract_size: float = 100000.0
    ):
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.broker = broker
        self.daily_dd_limit_amount = daily_dd_limit_amount
        self.contract_size = contract_size

    def handle_signal(self, signal: int, symbol: str, current_price: float) -> Dict[str, Any]:
        """
        Handle strategy signals, route them through risk controls, and execute on the broker.
        
        Args:
            signal: Strategy signal (1: BUY, -1: EXIT, 0: HOLD).
            symbol: Asset symbol (e.g. 'EURUSD').
            current_price: Current market quote.
            
        Returns:
            Dict containing execution status and result details.
        """
        # Fetch live state from broker client
        state = self.broker.get_account_state()
        balance = state["balance"]
        equity = state["equity"]
        open_positions = self.broker.get_open_positions()

        if signal == 1:
            lot_size = self.strategy.risk_params.get("base_lot", 0.1)
            sl_pct = self.strategy.risk_params["stop_loss_pct"]
            tp_pct = self.strategy.risk_params["take_profit_pct"]
            
            # Formulate hypothetical order execution estimates
            # (slippage is handled by broker, risk manager checks estimated worst-case loss)
            exec_price_estimate = current_price
            sl_price = exec_price_estimate * (1.0 - sl_pct)
            tp_price = exec_price_estimate * (1.0 + tp_pct)
            
            # Real-Time pre-trade risk compliance check
            check = self.risk_manager.check_order(
                symbol=symbol,
                direction="BUY",
                lot_size=lot_size,
                entry_price=exec_price_estimate,
                sl_price=sl_price,
                account_balance=balance,
                account_equity=equity,
                daily_dd_limit_amount=self.daily_dd_limit_amount,
                open_positions=open_positions,
                contract_size=self.contract_size
            )
            
            if check["approved"]:
                final_lot_size = check.get("adjusted_lot_size", lot_size)
                
                # Execute order on the broker terminal
                res = self.broker.place_order(
                    symbol=symbol,
                    direction="BUY",
                    lot_size=final_lot_size,
                    sl_price=sl_price,
                    tp_price=tp_price
                )
                
                # Update risk manager lot history on successful execution
                self.risk_manager.update_base_lot(symbol, final_lot_size)
                
                return {
                    "status": "EXECUTED",
                    "broker_result": res
                }
            else:
                return {
                    "status": "REJECTED",
                    "reason": check.get("reason", "Risk validation failed")
                }
                
        elif signal == -1:
            closed_ids = []
            for pos in open_positions:
                # Close all BUY positions for matching symbol
                if pos["symbol"] == symbol and pos["direction"] == "BUY":
                    res = self.broker.close_position(pos["position_id"])
                    closed_ids.append(pos["position_id"])
                    
            return {
                "status": "EXITS_PROCESSED",
                "closed_position_ids": closed_ids
            }
            
        else:
            return {
                "status": "HOLD"
            }
