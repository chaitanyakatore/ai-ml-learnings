import pytest
from quantprop.strategies.sma_crossover import SMACrossoverStrategy
from quantprop.risk.risk_manager import RiskManager
from quantprop.execution.mock_broker import MockLiveBroker
from quantprop.execution.execution_gateway import ExecutionGateway

def test_execution_gateway_flow():
    # Setup Strategy
    strategy = SMACrossoverStrategy(
        name="SMA_Cross",
        risk_params={"stop_loss_pct": 0.01, "take_profit_pct": 0.04, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=2,
        slow_period=5
    )
    
    # Setup Risk Manager
    risk_manager = RiskManager()
    
    # Setup Mock Broker
    broker = MockLiveBroker(
        initial_balance=10000.0,
        spread=0.0001,
        commission=2.0,
        slippage=0.0001,
        contract_size=100000.0
    )
    # Set current mock price
    broker.update_price("EURUSD", 1.1000)
    
    # Setup Gateway
    gateway = ExecutionGateway(
        strategy=strategy,
        risk_manager=risk_manager,
        broker=broker,
        daily_dd_limit_amount=300.0,
        contract_size=100000.0
    )
    
    # 1. Handle BUY signal (1)
    res = gateway.handle_signal(1, "EURUSD", 1.1000)
    assert res["status"] == "EXECUTED"
    assert "order_id" in res["broker_result"]
    assert res["broker_result"]["status"] == "FILLED"
    
    # Verify position exists in broker
    positions = broker.get_open_positions()
    assert len(positions) == 1
    assert positions[0]["symbol"] == "EURUSD"
    assert positions[0]["direction"] == "BUY"
    assert positions[0]["lot_size"] == 0.1
    
    # Verify account balance decreased by commissions (0.1 lot * 2.0 = 0.20)
    state = broker.get_account_state()
    assert state["balance"] == 9999.80
    
    # 2. Handle EXIT signal (-1)
    res_exit = gateway.handle_signal(-1, "EURUSD", 1.1000)
    assert res_exit["status"] == "EXITS_PROCESSED"
    assert len(res_exit["closed_position_ids"]) == 1
    assert len(broker.get_open_positions()) == 0
    
    # 3. Manually place a SELL position on broker to trigger hedging block
    broker.place_order("EURUSD", "SELL", 0.1, 1.1200, 1.0800)
    res_dup = gateway.handle_signal(1, "EURUSD", 1.1000)
    assert res_dup["status"] == "REJECTED"
    assert "hedging" in res_dup["reason"].lower()

def test_execution_gateway_lot_reset_and_blocking():
    strategy = SMACrossoverStrategy(
        name="SMA_Cross",
        risk_params={"stop_loss_pct": 0.01, "take_profit_pct": 0.04, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=2,
        slow_period=5
    )
    
    risk_manager = RiskManager()
    broker = MockLiveBroker(initial_balance=10000.0)
    broker.update_price("EURUSD", 1.1000)
    
    gateway = ExecutionGateway(
        strategy=strategy,
        risk_manager=risk_manager,
        broker=broker,
        daily_dd_limit_amount=1000.0
    )
    
    # Force a base-lot reset down by placing a smaller lot trade manually
    # Let's adjust risk parameters to have a base lot of 0.02
    strategy.risk_params["base_lot"] = 0.02
    res = gateway.handle_signal(1, "EURUSD", 1.1000)
    assert res["status"] == "EXECUTED"
    
    # Check that base lot was updated in RiskManager to 0.02
    assert risk_manager.base_lots.get("EURUSD") == 0.02
    
    # Close the position so we can try to place another order
    gateway.handle_signal(-1, "EURUSD", 1.1000)
    
    # Now place an order that exceeds the 5x cap (e.g. 0.15 lot, when base lot is 0.02, ceiling is 0.10)
    strategy.risk_params["base_lot"] = 0.15
    res_blocked = gateway.handle_signal(1, "EURUSD", 1.1000)
    
    assert res_blocked["status"] == "REJECTED"
    assert "lot size" in res_blocked["reason"].lower() or "base lot" in res_blocked["reason"].lower()
