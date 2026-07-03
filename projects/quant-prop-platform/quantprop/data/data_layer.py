import os
import json
import urllib.request
import urllib.error
import polars as pl
from datetime import datetime, timezone
from typing import Dict, Any, Optional

class DataLayer:
    """
    Manager for historical market data access, local caching, and mock data generation.
    """
    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)

    def get_historical_data(
        self, 
        symbol: str, 
        timeframe: str, 
        start_date: datetime, 
        end_date: datetime,
        force_download: bool = False
    ) -> pl.LazyFrame:
        """
        Fetch standardized historical price data. Checks local cache first,
        otherwise downloads from Yahoo Finance and updates cache.
        
        Args:
            symbol: Ticker symbol (e.g. 'EURUSD=X', 'GC=F', 'BTC-USD').
            timeframe: Time resolution (e.g. '1d', '1h', '1m').
            start_date: Start datetime (inclusive).
            end_date: End datetime (inclusive).
            force_download: If True, bypasses cache and downloads fresh data.
            
        Returns:
            A Polars LazyFrame with standard columns:
            ['timestamp', 'open', 'high', 'low', 'close', 'volume'].
        """
        cache_path = os.path.join(self.storage_dir, f"{symbol}_{timeframe}.parquet")
        
        # Convert start/end to offset-aware UTC datetimes for comparison
        start_utc = start_date.astimezone(timezone.utc)
        end_utc = end_date.astimezone(timezone.utc)
        
        if not force_download and os.path.exists(cache_path):
            try:
                # Read cache lazy
                lf = pl.scan_parquet(cache_path)
                
                # Check if the cache covers the requested range
                # We collect min/max to verify coverage
                cached_min_max = lf.select([
                    pl.col("timestamp").min().alias("min_ts"),
                    pl.col("timestamp").max().alias("max_ts")
                ]).collect()
                
                min_ts = cached_min_max[0, "min_ts"]
                max_ts = cached_min_max[0, "max_ts"]
                
                if min_ts is not None and max_ts is not None:
                    # Make sure the dates are in datetime format with UTC timezone
                    if min_ts.tzinfo is None:
                        min_ts = min_ts.replace(tzinfo=timezone.utc)
                    if max_ts.tzinfo is None:
                        max_ts = max_ts.replace(tzinfo=timezone.utc)
                        
                    if min_ts <= start_utc and max_ts >= end_utc:
                        # Cache hit, filter and return
                        return lf.filter(
                            (pl.col("timestamp") >= start_utc) & 
                            (pl.col("timestamp") <= end_utc)
                        )
            except Exception as e:
                # Cache read error, fall back to download
                pass

        # Cache miss or forced download -> Download from Yahoo Finance
        df = self._download_from_yahoo(symbol, timeframe, start_utc, end_utc)
        
        # Save to Parquet cache
        df.write_parquet(cache_path)
        
        return pl.scan_parquet(cache_path)

    def _download_from_yahoo(
        self, 
        symbol: str, 
        timeframe: str, 
        start_date: datetime, 
        end_date: datetime
    ) -> pl.DataFrame:
        """
        Downloads data from the Yahoo Finance v8/finance/chart API.
        """
        # Map timeframe to Yahoo Finance intervals
        # e.g., '1d' -> '1d', '1h' -> '1h', '1m' -> '1m'
        interval = timeframe
        
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())
        
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?"
            f"period1={start_ts}&period2={end_ts}&interval={interval}&events=history"
        )
        
        req = urllib.request.Request(
            url, 
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
        )
        
        try:
            with urllib.request.urlopen(req) as response:
                raw_data = json.loads(response.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Yahoo Finance request failed for {symbol}: {e.code} {e.reason}")
        except Exception as e:
            raise RuntimeError(f"Failed to fetch data from Yahoo Finance: {e}")
            
        result = raw_data.get("chart", {}).get("result")
        if not result or len(result) == 0:
            error_msg = raw_data.get("chart", {}).get("error", {}).get("description", "Unknown error")
            raise RuntimeError(f"Yahoo Finance returned no data for {symbol}: {error_msg}")
            
        chart_data = result[0]
        timestamps = chart_data.get("timestamp", [])
        indicators = chart_data.get("indicators", {}).get("quote", [{}])[0]
        
        opens = indicators.get("open", [])
        highs = indicators.get("high", [])
        lows = indicators.get("low", [])
        closes = indicators.get("close", [])
        volumes = indicators.get("volume", [])
        
        if not timestamps:
            raise ValueError(f"No timestamps returned for symbol {symbol} in range.")
            
        # Clean null values (sometimes Yahoo returns nulls for holiday periods)
        valid_rows = []
        for i in range(len(timestamps)):
            # Check if any OHLC value is None
            if (opens[i] is None or highs[i] is None or 
                lows[i] is None or closes[i] is None):
                continue
            
            # Map values
            dt = datetime.fromtimestamp(timestamps[i], tz=timezone.utc)
            valid_rows.append({
                "timestamp": dt,
                "open": float(opens[i]),
                "high": float(highs[i]),
                "low": float(lows[i]),
                "close": float(closes[i]),
                "volume": float(volumes[i]) if volumes[i] is not None else 0.0
            })
            
        if not valid_rows:
            raise ValueError(f"All data returned by Yahoo Finance for {symbol} contained null values.")
            
        df = pl.DataFrame(valid_rows)
        # Ensure correct column ordering
        return df.select(["timestamp", "open", "high", "low", "close", "volume"])

    @staticmethod
    def generate_mock_data(
        symbol: str,
        timeframe: str,
        start_date: datetime,
        end_date: datetime,
        pattern: str = "trend_up",
        initial_price: float = 100.0,
        bars_count: int = 100
    ) -> pl.DataFrame:
        """
        Generates synthetic historical OHLCV data for deterministic backtesting validation.
        
        Patterns:
        - 'trend_up': Steady upward trend.
        - 'trend_down': Steady downward trend.
        - 'sideways': Range-bound oscillations.
        - 'sharp_crash': Steady rise followed by a sharp drop.
        
        Returns:
            A Polars DataFrame containing mock OHLCV time-series.
        """
        import numpy as np
        
        # Determine timestamps
        start_ts = start_date.timestamp()
        end_ts = end_date.timestamp()
        timestamps_seconds = np.linspace(start_ts, end_ts, bars_count)
        
        prices = [initial_price]
        np.random.seed(42)  # Seed for deterministic mock generation
        
        # Build price path
        for i in range(1, bars_count):
            prev = prices[-1]
            if pattern == "trend_up":
                change = np.random.normal(0.2, 0.5)  # upward drift
            elif pattern == "trend_down":
                change = np.random.normal(-0.2, 0.5)  # downward drift
            elif pattern == "sideways":
                # Oscillate around initial_price
                deviation = prev - initial_price
                change = np.random.normal(-0.1 * deviation, 0.5)
            elif pattern == "sharp_crash":
                if i < int(bars_count * 0.7):
                    change = np.random.normal(0.3, 0.4)  # upward rise
                else:
                    change = -prev * np.random.uniform(0.08, 0.12)  # sharp crash (8-12% drop per bar)
            else:
                change = np.random.normal(0, 0.5)  # random walk
                
            prices.append(max(0.01, prev + change))
            
        rows = []
        for i in range(bars_count):
            price = prices[i]
            dt = datetime.fromtimestamp(timestamps_seconds[i], tz=timezone.utc)
            # Create a realistic bar range
            noise = price * 0.005
            o = price + np.random.normal(0, noise)
            c = price
            h = max(o, c) + abs(np.random.normal(0, noise))
            l = min(o, c) - abs(np.random.normal(0, noise))
            
            rows.append({
                "timestamp": dt,
                "open": float(max(0.01, o)),
                "high": float(max(0.01, h)),
                "low": float(max(0.01, l)),
                "close": float(max(0.01, c)),
                "volume": float(np.random.randint(1000, 10000))
            })
            
        df = pl.DataFrame(rows)
        return df.select(["timestamp", "open", "high", "low", "close", "volume"])

