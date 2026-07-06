import polars as pl

def add_sma(df: pl.LazyFrame, column: str, period: int) -> pl.LazyFrame:
    """
    Calculate Simple Moving Average.
    
    Args:
        df: Input price LazyFrame.
        column: Column to compute average on (usually 'close').
        period: Moving average window size.
        
    Returns:
        LazyFrame with the indicator column added.
    """
    return df.with_columns(
        pl.col(column).rolling_mean(window_size=period).alias(f"{column}_sma_{period}")
    )

def add_ema(df: pl.LazyFrame, column: str, period: int) -> pl.LazyFrame:
    """
    Calculate Exponential Moving Average (EMA).
    """
    return df.with_columns(
        pl.col(column).ewm_mean(span=period, adjust=False).alias(f"{column}_ema_{period}")
    )

def add_atr(df: pl.LazyFrame, period: int) -> pl.LazyFrame:
    """
    Calculate Average True Range (ATR).
    
    ATR measures market volatility. It is the rolling average of the True Range (TR),
    which is defined as the maximum of:
    - Current High - Current Low
    - |Current High - Previous Close|
    - |Current Low - Previous Close|
    """
    prev_close = pl.col("close").shift(1)
    
    # Calculate True Range (TR)
    tr = pl.max_horizontal([
        pl.col("high") - pl.col("low"),
        (pl.col("high") - prev_close).abs(),
        (pl.col("low") - prev_close).abs()
    ]).fill_null(pl.col("high") - pl.col("low")).alias("true_range")
    
    # ATR is the rolling mean of TR
    return df.with_columns(tr).with_columns(
        pl.col("true_range").rolling_mean(window_size=period).alias(f"atr_{period}")
    ).drop("true_range")

def add_rsi(df: pl.LazyFrame, period: int = 14) -> pl.LazyFrame:
    """
    Calculate Relative Strength Index (RSI).
    
    Uses Wilder's Exponential Moving Average smoothing approximation (alpha = 1 / period).
    """
    close_diff = pl.col("close").diff()
    
    gain = pl.when(close_diff > 0).then(close_diff).otherwise(0.0).alias("gain")
    loss = pl.when(close_diff < 0).then(-close_diff).otherwise(0.0).alias("loss")
    
    # Calculate Wilder's EMA for Gain and Loss
    # ewm_mean calculates exponential moving average. With adjust=False, it uses the standard recursion formula.
    avg_gain = pl.col("gain").ewm_mean(alpha=1.0/period, adjust=False).alias("avg_gain")
    avg_loss = pl.col("loss").ewm_mean(alpha=1.0/period, adjust=False).alias("avg_loss")
    
    # Divide gain by loss to get RS. Handle division by zero.
    rs = pl.col("avg_gain") / pl.col("avg_loss")
    rsi_expr = pl.when(pl.col("avg_loss") == 0.0).then(100.0).otherwise(
        100.0 - (100.0 / (1.0 + rs))
    ).alias(f"rsi_{period}")
    
    # Run in a single with_columns pipeline
    return df.with_columns([gain, loss]).with_columns([
        avg_gain, avg_loss
    ]).with_columns(rsi_expr).drop(["gain", "loss", "avg_gain", "avg_loss"])

def add_bollinger_bands(
    df: pl.LazyFrame, 
    column: str = "close", 
    period: int = 20, 
    std_dev_multiplier: float = 2.0
) -> pl.LazyFrame:
    """
    Calculate Bollinger Bands (Middle, Upper, Lower Bands).
    """
    middle = pl.col(column).rolling_mean(window_size=period).alias(f"{column}_bb_middle_{period}")
    std_dev = pl.col(column).rolling_std(window_size=period)
    
    upper = (pl.col(f"{column}_bb_middle_{period}") + std_dev_multiplier * std_dev).alias(f"{column}_bb_upper_{period}")
    lower = (pl.col(f"{column}_bb_middle_{period}") - std_dev_multiplier * std_dev).alias(f"{column}_bb_lower_{period}")
    
    return df.with_columns(middle).with_columns([upper, lower])

def add_macd(
    df: pl.LazyFrame, 
    fast_period: int = 12, 
    slow_period: int = 26, 
    signal_period: int = 9
) -> pl.LazyFrame:
    """
    Calculate Moving Average Convergence Divergence (MACD).
    
    Returns columns: macd_line, macd_signal, macd_histogram.
    """
    ema_fast = pl.col("close").ewm_mean(span=fast_period, adjust=False)
    ema_slow = pl.col("close").ewm_mean(span=slow_period, adjust=False)
    
    macd_line = (ema_fast - ema_slow).alias("macd_line")
    
    # After adding macd_line, we compute macd_signal on top of it
    df_macd = df.with_columns(macd_line)
    macd_signal = pl.col("macd_line").ewm_mean(span=signal_period, adjust=False).alias("macd_signal")
    
    df_macd_signal = df_macd.with_columns(macd_signal)
    macd_histogram = (pl.col("macd_line") - pl.col("macd_signal")).alias("macd_histogram")
    
    return df_macd_signal.with_columns(macd_histogram)
