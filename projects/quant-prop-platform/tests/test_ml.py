import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.ml.ml_filter import MLTradeFilter
from quantprop.strategies.sma_crossover import SMACrossoverStrategy
from quantprop.backtest.backtester import BacktestEngine

def test_ml_filter_training():
    # Setup mock data: 20 samples (RandomForestClassifier needs enough samples to train/test split)
    features = pl.DataFrame({
        "rsi": [30.0 + i * 2 for i in range(20)],
        "atr": [1.5 + i * 0.1 for i in range(20)]
    })
    
    # 10 wins (1), 10 losses (0)
    labels = [1] * 10 + [0] * 10
    
    ml_filter = MLTradeFilter(model_config={"n_estimators": 10, "max_depth": 3}, random_seed=42)
    res = ml_filter.train(features, labels)
    
    assert ml_filter.is_trained
    assert "test_accuracy" in res
    assert "feature_importances" in res
    assert "rsi" in ml_filter.feature_importances
    assert "atr" in ml_filter.feature_importances
    
    # Test prediction
    prob = ml_filter.should_execute({"rsi": 32.0, "atr": 1.6})
    assert 0.0 <= prob <= 1.0

def test_backtest_with_ml_filter():
    # Create mock dataset where we have SMA indicators and custom features (like rsi_14)
    # We will generate signals using SMACrossoverStrategy.
    # SMA Crossover uses close, fast_period, slow_period
    start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    
    # Generate 30 bars. We will hardcode a price sequence that triggers crosses.
    # Also add "rsi_14" feature explicitly to the dataframe since we will use it for the ML model.
    # W1 triggers BUY signal. Let's make price cross SMA 2 over SMA 5.
    # Let's verify we have a close column.
    rows = []
    for i in range(30):
        # Trigger buy signals by raising close price periodically
        if i in [10, 20]:
            close_price = 105.0 # upward cross
        else:
            close_price = 100.0
            
        rows.append({
            "timestamp": start + timedelta(hours=i),
            "open": 100.0,
            "high": close_price + 1.0,
            "low": 99.0,
            "close": close_price,
            "volume": 1000.0,
            "rsi_14": 30.0 if i == 10 else 60.0 # Make RSI 30 at i=10 (good trade), 60 at i=20 (bad trade)
        })
        
    df = pl.DataFrame(rows).lazy()
    
    # Train the ML model to learn that rsi_14 <= 35 leads to a win (1), and > 35 leads to a loss (0)
    train_features = pl.DataFrame({
        "rsi_14": [25.0, 30.0, 32.0, 28.0, 34.0, 50.0, 60.0, 55.0, 70.0, 65.0]
    })
    train_labels = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
    
    ml_filter = MLTradeFilter(model_config={"n_estimators": 10, "max_depth": 3}, random_seed=42)
    ml_filter.train(train_features, train_labels)
    
    # Verify model predicts high probability of win for RSI=30 and low for RSI=60
    assert ml_filter.should_execute({"rsi_14": 30.0}) > 0.60
    assert ml_filter.should_execute({"rsi_14": 60.0}) < 0.40
    
    # Setup strategy
    strategy = SMACrossoverStrategy(
        name="SMA_Cross",
        risk_params={"stop_loss_pct": 0.02, "take_profit_pct": 0.04, "risk_percent": 0.01, "base_lot": 0.1},
        fast_period=2,
        slow_period=5
    )
    
    # Run backtester without ML filter
    engine_no_ml = BacktestEngine(
        strategy=strategy,
        initial_balance=10000.0,
        contract_size=100.0
    )
    res_no_ml = engine_no_ml.run(df)
    trades_no_ml = len(res_no_ml["trade_log"])
    
    # Run backtester with ML filter (filter threshold = 0.55)
    # The signal at i=10 (rsi_14 = 30) should pass.
    # The signal at i=20 (rsi_14 = 60) should be blocked by the ML model.
    engine_ml = BacktestEngine(
        strategy=strategy,
        initial_balance=10000.0,
        contract_size=100.0,
        ml_filter=ml_filter,
        ml_filter_threshold=0.55
    )
    res_ml = engine_ml.run(df)
    trades_ml = len(res_ml["trade_log"])
    
    # Confirm that the ML filter blocked the low probability trade
    assert trades_no_ml > trades_ml
    assert trades_ml == 1 # only the first trade executing at rsi_14=30 was allowed!
