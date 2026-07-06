import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.strategies.sma_crossover import SMACrossoverStrategy
from quantprop.optimization.optimizer import StrategyOptimizer

def test_grid_search():
    # Setup simple mock data
    start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    rows = [{"timestamp": start + timedelta(hours=i), "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 100.0} for i in range(20)]
    df = pl.DataFrame(rows).lazy()
    
    param_grid = {
        "fast_period": [2, 3],
        "slow_period": [5, 6]
    }
    
    backtest_config = {
        "initial_balance": 10000.0,
        "risk_params": {
            "stop_loss_pct": 0.02,
            "take_profit_pct": 0.04,
            "risk_percent": 0.01,
            "base_lot": 0.1
        }
    }
    
    optimizer = StrategyOptimizer()
    opt_df = optimizer.grid_search(
        strategy_class=SMACrossoverStrategy,
        param_grid=param_grid,
        data=df,
        backtest_config=backtest_config
    )
    
    # 4 combinations: (2,5), (2,6), (3,5), (3,6)
    assert len(opt_df) == 4
    assert "fast_period" in opt_df.columns
    assert "slow_period" in opt_df.columns
    assert "score" in opt_df.columns
    # Check sorting
    scores = opt_df["score"].to_list()
    assert all(scores[i] >= scores[i+1] for i in range(len(scores)-1))

def test_walk_forward():
    # Setup data spanning 25 days (25 daily bars)
    start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    rows = []
    # Make prices drift up so we get some positive trades
    price = 100.0
    for i in range(25):
        price += 1.0
        rows.append({
            "timestamp": start + timedelta(days=i),
            "open": price - 0.2,
            "high": price + 0.5,
            "low": price - 0.5,
            "close": price,
            "volume": 1000.0
        })
    df = pl.DataFrame(rows).lazy()
    
    param_grid = {
        "fast_period": [2, 3],
        "slow_period": [5, 6]
    }
    
    backtest_config = {
        "initial_balance": 10000.0,
        "risk_params": {
            "stop_loss_pct": 0.50, # large stop to keep trades open
            "take_profit_pct": 0.50,
            "risk_percent": 0.01,
            "base_lot": 0.1
        },
        "contract_size": 100.0 # small contract size
    }
    
    optimizer = StrategyOptimizer()
    # 25 days: Train 10 days, Test 5 days.
    # W1: Train 0-10, Test 10-15
    # W2: Train 5-15, Test 15-20
    # W3: Train 10-20, Test 20-25
    results = optimizer.walk_forward_test(
        strategy_class=SMACrossoverStrategy,
        param_grid=param_grid,
        data=df,
        train_days=10,
        test_days=5,
        backtest_config=backtest_config
    )
    
    trade_log = results["trade_log"]
    equity_curve = results["equity_curve"]
    
    assert isinstance(trade_log, pl.DataFrame)
    assert isinstance(equity_curve, pl.DataFrame)
    
    # Check that out-of-sample data points exist
    assert len(equity_curve) > 0
    # Check that the dates of out-of-sample starts at or after day 10 (Jan 11)
    min_oos_time = equity_curve["timestamp"].min()
    assert min_oos_time >= start + timedelta(days=10)
