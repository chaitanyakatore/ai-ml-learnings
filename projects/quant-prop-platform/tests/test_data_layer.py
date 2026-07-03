import os
import shutil
import polars as pl
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
import pytest
from quantprop.data.data_layer import DataLayer

@pytest.fixture
def temp_storage():
    storage_dir = "./test_data_cache"
    if os.path.exists(storage_dir):
        shutil.rmtree(storage_dir)
    os.makedirs(storage_dir, exist_ok=True)
    yield storage_dir
    # Cleanup after test
    if os.path.exists(storage_dir):
        shutil.rmtree(storage_dir)

def test_generate_mock_data():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 10, tzinfo=timezone.utc)
    
    df = DataLayer.generate_mock_data(
        symbol="EURUSD",
        timeframe="1d",
        start_date=start,
        end_date=end,
        pattern="trend_up",
        bars_count=20
    )
    
    assert isinstance(df, pl.DataFrame)
    assert len(df) == 20
    assert list(df.columns) == ["timestamp", "open", "high", "low", "close", "volume"]
    assert df["timestamp"].dtype == pl.Datetime
    # Check that prices are valid
    assert (df["close"] > 0).all()
    assert (df["high"] >= df["low"]).all()

@patch("urllib.request.urlopen")
def test_data_layer_cache_and_download(mock_urlopen, temp_storage):
    # Mock Yahoo Finance JSON response
    mock_response = MagicMock()
    mock_json = {
        "chart": {
            "result": [
                {
                    "timestamp": [1767225600, 1767312000],  # 2026-01-01, 2026-01-02
                    "indicators": {
                        "quote": [
                            {
                                "open": [1.10, 1.11],
                                "high": [1.12, 1.13],
                                "low": [1.09, 1.10],
                                "close": [1.11, 1.12],
                                "volume": [1000, 1100]
                            }
                        ]
                    }
                }
            ],
            "error": None
        }
    }
    
    import json
    mock_response.read.return_value = json.dumps(mock_json).encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response
    
    dl = DataLayer(storage_dir=temp_storage)
    
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 2, tzinfo=timezone.utc)
    
    # 1. First fetch (cache miss -> triggers download)
    lf = dl.get_historical_data("EURUSD=X", "1d", start, end)
    df = lf.collect()
    
    assert len(df) == 2
    assert df[0, "close"] == 1.11
    assert df[1, "close"] == 1.12
    assert mock_urlopen.call_count == 1
    
    # Check that file was cached
    cache_file = os.path.join(temp_storage, "EURUSD=X_1d.parquet")
    assert os.path.exists(cache_file)
    
    # 2. Second fetch (cache hit -> no download)
    lf_cached = dl.get_historical_data("EURUSD=X", "1d", start, end)
    df_cached = lf_cached.collect()
    
    assert len(df_cached) == 2
    assert df_cached[0, "close"] == 1.11
    assert mock_urlopen.call_count == 1  # Still 1, did not call download again
