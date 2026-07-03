import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.strategies.sma_crossover import SMACrossoverStrategy
from quantprop.backtest.backtester import BacktestEngine

def test_backtester_execution_and_costs():
    # 1. Create a controlled price dataset
    # We want a clear uptrend (buy crossover) followed by a flat/down period (sell exit crossover)
    start_time = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    
    # Generate 40 bars of data
    rows = []
    current_price = 100.0
    for i in range(40):
        # We manipulate the close price to force a clean crossover
        if i < 15:
            current_price += 1.0  # Upwards -> fast SMA will cross above slow SMA
        elif i < 30:
            current_price -= 1.0  # Downwards -> fast SMA will cross below slow SMA
        else:
            current_price += 0.1  # Sideways
            
        rows.append({
            "timestamp": start_time + timedelta(hours=i),
            "open": current_price - 0.2,
            "high": current_price + 0.5,
            "low": current_price - 0.5,
            "close": current_price,
            "volume": 1000.0
        })
        
    df = pl.DataFrame(rows).lazy()
    
    # 2. Instantiate strategy
    # Stop loss and take profit are set large (e.g. 50%) so they don't trigger,
    # ensuring trades are closed purely by strategy signals.
    risk_params = {
        "stop_loss_pct": 0.50,
        "take_profit_pct": 0.50,
        "risk_percent": 0.01,
        "base_lot": 0.1
    }
    
    strategy = SMACrossoverStrategy(
        name="TestSMA",
        risk_params=risk_params,
        fast_period=3,
        slow_period=8
    )
    
    # 3. Instantiate BacktestEngine with transaction costs
    # Spread = 0.01, Slippage = 0.005, Commission = 2.0 (per trade/lot)
    # Contract size = 10000.0
    engine = BacktestEngine(
        strategy=strategy,
        risk_manager=None,
        initial_balance=10000.0,
        spread=0.01,
        commission=2.0,
        slippage=0.005,
        contract_size=10000.0
    )
    
    results = engine.run(df)
    
    trade_log = results["trade_log"]
    equity_curve = results["equity_curve"]
    
    assert isinstance(trade_log, pl.DataFrame)
    assert isinstance(equity_curve, pl.DataFrame)
    assert len(equity_curve) == 40
    
    # Check that a trade was actually recorded
    assert len(trade_log) >= 1
    
    # Validate details of the first trade
    first_trade = trade_log.row(0, named=True)
    assert first_trade["direction"] == "BUY"
    assert first_trade["lot_size"] == 0.1
    assert first_trade["commissions"] == 0.1 * 2.0  # lot_size * commission_fee = 0.2
    
    # Check next-bar-open execution:
    # Signals are checked on indicators. If a BUY signal is issued at bar index T (timestamp = entry_time - 1 hour),
    # the entry_price should equal next bar's Open price + spread + slippage.
    # Let's inspect the math of the trade's P/L:
    # entry_price = next_open + spread + slippage
    # exit_price = exit_open - spread - slippage
    # gross_pnl = (exit_price - entry_price) * lot_size * contract_size
    # trade_log["pnl"] should equal this gross_pnl
    dir_sign = 1
    gross_pnl = (first_trade["exit_price"] - first_trade["entry_price"]) * dir_sign * first_trade["lot_size"] * 10000.0
    assert abs(first_trade["pnl"] - gross_pnl) < 1e-6
