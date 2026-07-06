import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.strategies.sma_crossover import SMACrossoverStrategy
from quantprop.portfolio.portfolio_manager import PortfolioManager

def test_equal_weight_portfolio():
    # Setup data: 30 daily bars, uptrend
    start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    rows = []
    price = 100.0
    for i in range(30):
        # Create crosses periodically
        if i in [5, 15]:
            close_price = price + 5.0
        else:
            close_price = price
        rows.append({
            "timestamp": start + timedelta(days=i),
            "open": price - 0.2,
            "high": close_price + 0.5,
            "low": price - 0.5,
            "close": close_price,
            "volume": 1000.0
        })
    df1 = pl.DataFrame(rows).lazy()
    df2 = pl.DataFrame(rows).lazy()
    
    # 2 strategies
    strat1 = SMACrossoverStrategy(
        name="Strat1",
        risk_params={"stop_loss_pct": 0.10, "take_profit_pct": 0.20, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=2, slow_period=5
    )
    strat2 = SMACrossoverStrategy(
        name="Strat2",
        risk_params={"stop_loss_pct": 0.10, "take_profit_pct": 0.20, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=3, slow_period=6
    )
    
    manager = PortfolioManager([strat1, strat2], allocation_method="equal_weight")
    res = manager.run_portfolio([df1, df2], {"initial_balance": 10000.0, "contract_size": 100.0})
    
    assert res["weights"] == [0.5, 0.5]
    assert isinstance(res["trade_log"], pl.DataFrame)
    assert isinstance(res["equity_curve"], pl.DataFrame)
    assert "strategy" in res["trade_log"].columns
    
    # Ensure starting and ending bounds
    assert res["equity_curve"][0, "balance"] == 10000.0
    assert res["equity_curve"][0, "equity"] == 10000.0

def test_risk_parity_portfolio():
    # Setup data where one asset is highly volatile, other is low volatility
    start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    
    # Volatile asset: alternates +/- 10%
    rows_volatile = []
    # Stable asset: alternates +/- 1%
    rows_stable = []
    
    for i in range(10):
        v_close = 100.0 * (1.10 if i % 2 == 0 else 0.90)
        s_close = 100.0 * (1.01 if i % 2 == 0 else 0.99)
        
        rows_volatile.append({
            "timestamp": start + timedelta(days=i), "open": 100.0, "high": 120.0, "low": 80.0, "close": v_close, "volume": 1000.0
        })
        rows_stable.append({
            "timestamp": start + timedelta(days=i), "open": 100.0, "high": 102.0, "low": 98.0, "close": s_close, "volume": 1000.0
        })
        
    df_vol = pl.DataFrame(rows_volatile).lazy()
    df_stab = pl.DataFrame(rows_stable).lazy()
    
    strat_vol = SMACrossoverStrategy(
        name="VolStrat",
        risk_params={"stop_loss_pct": 0.50, "take_profit_pct": 0.50, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=2, slow_period=3
    )
    strat_stab = SMACrossoverStrategy(
        name="StableStrat",
        risk_params={"stop_loss_pct": 0.50, "take_profit_pct": 0.50, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=2, slow_period=3
    )
    
    manager = PortfolioManager([strat_vol, strat_stab], allocation_method="risk_parity")
    res = manager.run_portfolio([df_vol, df_stab], {"initial_balance": 10000.0, "contract_size": 10.0})
    
    weights = res["weights"]
    # Strategy with lower volatility (StableStrat) must receive higher weight
    # StableStrat is index 1, VolStrat is index 0
    assert weights[1] > weights[0]
