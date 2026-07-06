import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.features.feature_engineering import (
    add_ema, add_rsi, add_bollinger_bands, add_macd
)

def test_add_ema():
    # Setup data
    df = pl.DataFrame({
        "close": [10.0, 11.0, 12.0, 13.0, 14.0]
    }).lazy()
    
    # Compute 3-period EMA
    df_ema = add_ema(df, "close", period=3).collect()
    assert "close_ema_3" in df_ema.columns
    # Check that values are computed
    assert df_ema[0, "close_ema_3"] is not None

def test_add_rsi():
    # Setup data: 15 identical rows -> RSI should be neutral, or rising rows -> RSI high
    df_rising = pl.DataFrame({
        "close": [100.0 + i for i in range(20)]
    }).lazy()
    
    df_rsi = add_rsi(df_rising, period=14).collect()
    assert "rsi_14" in df_rsi.columns
    # With a steady rise, RSI should be very high (e.g., >80) towards the end of the series
    assert df_rsi[-1, "rsi_14"] > 80.0

def test_add_bollinger_bands():
    df = pl.DataFrame({
        "close": [10.0, 11.0, 12.0, 13.0, 14.0, 15.0]
    }).lazy()
    
    df_bb = add_bollinger_bands(df, column="close", period=3, std_dev_multiplier=2.0).collect()
    
    assert "close_bb_middle_3" in df_bb.columns
    assert "close_bb_upper_3" in df_bb.columns
    assert "close_bb_lower_3" in df_bb.columns
    
    # Upper band must be greater than middle, and lower band must be less than middle
    for i in range(2, len(df_bb)):
        assert df_bb[i, "close_bb_upper_3"] > df_bb[i, "close_bb_middle_3"]
        assert df_bb[i, "close_bb_lower_3"] < df_bb[i, "close_bb_middle_3"]

def test_add_macd():
    df = pl.DataFrame({
        "close": [10.0 + i * 0.1 for i in range(30)]
    }).lazy()
    
    df_macd = add_macd(df, fast_period=12, slow_period=26, signal_period=9).collect()
    
    assert "macd_line" in df_macd.columns
    assert "macd_signal" in df_macd.columns
    assert "macd_histogram" in df_macd.columns
    
    # Check histogram equation: hist = line - signal
    for i in range(len(df_macd)):
        if df_macd[i, "macd_line"] is not None and df_macd[i, "macd_signal"] is not None:
            diff = df_macd[i, "macd_line"] - df_macd[i, "macd_signal"]
            assert abs(df_macd[i, "macd_histogram"] - diff) < 1e-6
