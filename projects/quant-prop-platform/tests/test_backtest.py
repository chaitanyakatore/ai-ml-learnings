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

def test_risk_manager_rules():
    from quantprop.risk.risk_manager import RiskManager
    
    rm = RiskManager()
    
    # 1. Test Hedging
    open_positions = [{"symbol": "EURUSD", "direction": "BUY"}]
    check = rm.check_order(
        symbol="EURUSD",
        direction="SELL", # Opposite -> Hedging
        lot_size=1.0,
        entry_price=1.10,
        sl_price=1.09,
        account_balance=10000.0,
        account_equity=10000.0,
        daily_dd_limit_amount=300.0,
        open_positions=open_positions
    )
    assert check["approved"] is False
    assert "Hedging prohibited" in check["reason"]
    
    # 2. Test Single Trade Loss Cap (40% daily drawdown = 300 * 0.4 = 120 cap)
    # worst case loss: (100 - 98) * 0.1 * 100,000 = 20,000 (which is > 120)
    check_loss = rm.check_order(
        symbol="EURUSD",
        direction="BUY",
        lot_size=0.1,
        entry_price=100.0,
        sl_price=98.0,
        account_balance=10000.0,
        account_equity=10000.0,
        daily_dd_limit_amount=300.0,
        open_positions=[],
        contract_size=100000.0
    )
    assert check_loss["approved"] is False
    assert "Single trade loss cap exceeded" in check_loss["reason"]
    
    # 3. Test Base Lot sizing
    # Initialize base lot by executing a trade of size 1.0
    rm.update_base_lot("EURUSD", 1.0)
    assert rm.base_lots["EURUSD"] == 1.0
    
    # Try placing 6.0 lots (exceeds 5x base = 5.0)
    check_lot_fail = rm.check_order(
        symbol="EURUSD",
        direction="BUY",
        lot_size=6.0,
        entry_price=1.10,
        sl_price=1.10, # SL equal to entry to ensure 0 loss and bypass loss cap check
        account_balance=10000.0,
        account_equity=10000.0,
        daily_dd_limit_amount=1000.0, # high daily limit to avoid loss cap
        open_positions=[]
    )
    assert check_lot_fail["approved"] is False
    assert "Position size violation" in check_lot_fail["reason"]
    
    # Place a trade of size 0.5 (resets base lot down to 0.5)
    rm.update_base_lot("EURUSD", 0.5)
    assert rm.base_lots["EURUSD"] == 0.5
    
    # Now, 3.0 lots should fail (exceeds 5x of new base 0.5 = 2.5)
    check_new_lot_fail = rm.check_order(
        symbol="EURUSD",
        direction="BUY",
        lot_size=3.0,
        entry_price=1.10,
        sl_price=1.10,
        account_balance=10000.0,
        account_equity=10000.0,
        daily_dd_limit_amount=1000.0,
        open_positions=[]
    )
    assert check_new_lot_fail["approved"] is False

def test_backtest_drawdown_breach():
    # Verify that backtester breaks execution on a drawdown breach
    start_time = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    
    # Generate 10 bars of data with a massive crash to trigger daily drawdown (limit = 300)
    rows = []
    prices = [100.0, 101.0, 102.0, 95.0, 90.0, 80.0, 70.0, 60.0, 50.0, 40.0]
    for i in range(10):
        price = prices[i]
        rows.append({
            "timestamp": start_time + timedelta(hours=i),
            "open": price,
            "high": price + 0.5,
            "low": price - 0.5,
            "close": price,
            "volume": 1000.0
        })
    df = pl.DataFrame(rows).lazy()
    
    # Setup strategy that buys immediately and holds
    # stop_loss_pct = 0.5 (large, to check that daily dd floor triggers first)
    risk_params = {
        "stop_loss_pct": 0.50,
        "take_profit_pct": 0.50,
        "risk_percent": 0.01,
        "base_lot": 1.0 # Standard lot
    }
    
    # Create simple dummy strategy that emits BUY signal on bar 1 (index 0)
    class ImmediateBuyStrategy(SMACrossoverStrategy):
        def generate_signals(self, df: pl.LazyFrame) -> pl.LazyFrame:
            return df.with_columns(
                pl.when(pl.col("open") == 100.0)
                .then(1)
                .otherwise(0)
                .alias("signal")
            )
            
    strategy = ImmediateBuyStrategy("ImmediateBuy", risk_params)
    
    # Run backtester with initial balance = 10000, contract size = 100
    # Potential loss on drop to 95: (95 - 101) * 1.0 * 100 = -600 (exceeds 300 daily DD floor)
    engine = BacktestEngine(
        strategy=strategy,
        initial_balance=10000.0,
        spread=0.0,
        commission=0.0,
        slippage=0.0,
        contract_size=100.0
    )
    
    results = engine.run(df)
    
    assert results["breached"] is True
    assert results["breach_reason"] == "daily_drawdown_breach"
    # Backtest should have terminated early
    assert len(results["equity_curve"]) < 10

