import polars as pl
import math
from datetime import datetime, timezone, timedelta
from quantprop.analytics.analytics_reporter import AnalyticsReporter

def test_analytics_metrics():
    # Setup trade log
    t_start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    
    # 4 trades: 2 wins, 2 losses
    trade_log = pl.DataFrame([
        {
            "symbol": "MOCK", "direction": "BUY", "lot_size": 0.1,
            "entry_time": t_start, "entry_price": 100.0,
            "exit_time": t_start + timedelta(hours=1), "exit_price": 102.0,
            "pnl": 200.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        },
        {
            "symbol": "MOCK", "direction": "BUY", "lot_size": 0.1,
            "entry_time": t_start + timedelta(days=1), "entry_price": 100.0,
            "exit_time": t_start + timedelta(days=1, hours=1), "exit_price": 99.0,
            "pnl": -100.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        },
        {
            "symbol": "MOCK", "direction": "BUY", "lot_size": 0.1,
            "entry_time": t_start + timedelta(days=2), "entry_price": 100.0,
            "exit_time": t_start + timedelta(days=2, hours=1), "exit_price": 103.0,
            "pnl": 300.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        },
        {
            "symbol": "MOCK", "direction": "BUY", "lot_size": 0.1,
            "entry_time": t_start + timedelta(days=3), "entry_price": 100.0,
            "exit_time": t_start + timedelta(days=3, hours=1), "exit_price": 98.0,
            "pnl": -200.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        }
    ])
    
    # Setup equity curve
    # Initial: 10000 -> 10200 -> 10100 -> 10400 -> 10200
    # Peak = 10400. Trough after peak = 10200.
    # Max DD = (10400 - 10200) / 10400 = 200 / 10400 = 1.923%
    t1 = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)
    t3 = datetime(2026, 1, 3, 0, 0, tzinfo=timezone.utc)
    t4 = datetime(2026, 1, 4, 0, 0, tzinfo=timezone.utc)
    t5 = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)
    
    equity_curve = pl.DataFrame([
        {"timestamp": t1, "balance": 10000.0, "equity": 10000.0},
        {"timestamp": t2, "balance": 10200.0, "equity": 10200.0},
        {"timestamp": t3, "balance": 10100.0, "equity": 10100.0},
        {"timestamp": t4, "balance": 10400.0, "equity": 10400.0},
        {"timestamp": t5, "balance": 10200.0, "equity": 10200.0}
    ])
    
    reporter = AnalyticsReporter(trading_days_per_year=252)
    metrics = reporter.calculate_metrics(trade_log, equity_curve)
    
    assert metrics["total_trades"] == 4
    assert metrics["winning_trades"] == 2
    assert metrics["losing_trades"] == 2
    assert metrics["win_rate"] == 0.50
    assert metrics["profit_factor"] == 500.0 / 300.0
    assert metrics["net_profit"] == 200.0 # wins(500) + losses(-300)
    assert abs(metrics["max_drawdown_pct"] - (200.0 / 10400.0)) < 1e-6
    
    # Check that Sharpe and Sortino ratios exist
    assert "sharpe_ratio" in metrics
    assert "sortino_ratio" in metrics
    
    # Check report generation
    evaluation_verdict = {
        "passed": True,
        "breached": False,
        "breach_reason": None,
        "flags": [],
        "metrics": {
            "net_profit": 200.0,
            "profit_target_met": True,
            "trading_days_count": 4,
            "min_trading_days_met": True,
            "max_drawdown_breached": False
        }
    }
    
    report = reporter.generate_report(metrics, evaluation_verdict)
    assert "Challenge Verdict" in report
    assert "PASS" in report
    assert "Net Profit" in report
