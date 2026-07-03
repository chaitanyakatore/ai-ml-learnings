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

