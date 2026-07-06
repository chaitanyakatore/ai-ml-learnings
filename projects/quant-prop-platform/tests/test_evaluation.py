import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.evaluation.evaluation_engine import EvaluationEngine

def test_trade_clustering():
    # Setup trades
    t1 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 1, 1, 12, 1, 30, tzinfo=timezone.utc) # 1m30s (cluster 1)
    t3 = datetime(2026, 1, 1, 12, 3, 1, tzinfo=timezone.utc)  # 3m01s (cluster 2 - new anchor)
    
    trade_log = pl.DataFrame([
        {
            "symbol": "EURUSD",
            "direction": "BUY",
            "lot_size": 1.0,
            "entry_time": t1,
            "entry_price": 1.1000,
            "exit_time": t1 + timedelta(minutes=5),
            "exit_price": 1.1050,
            "pnl": 500.0,
            "commissions": 2.0,
            "exit_reason": "SIGNAL"
        },
        {
            "symbol": "EURUSD",
            "direction": "BUY",
            "lot_size": 2.0,
            "entry_time": t2,
            "entry_price": 1.1100,
            "exit_time": t2 + timedelta(minutes=4),
            "exit_price": 1.1150,
            "pnl": 1000.0,
            "commissions": 4.0,
            "exit_reason": "SIGNAL"
        },
        {
            "symbol": "EURUSD",
            "direction": "BUY",
            "lot_size": 1.0,
            "entry_time": t3,
            "entry_price": 1.1200,
            "exit_time": t3 + timedelta(minutes=5),
            "exit_price": 1.1250,
            "pnl": 500.0,
            "commissions": 2.0,
            "exit_reason": "SIGNAL"
        }
    ])
    
    eval_eng = EvaluationEngine()
    clustered = eval_eng.cluster_trades(trade_log)
    
    assert len(clustered) == 2
    
    # Sort to be sure of row checking
    clustered = clustered.sort("entry_time")
    
    # Cluster 1 (Trade 1 and Trade 2)
    c1 = clustered.row(0, named=True)
    assert c1["lot_size"] == 3.0
    assert c1["entry_time"] == t1
    # Weighted entry: (1.10 * 1.0 + 1.11 * 2.0) / 3.0 = 1.1066666...
    assert abs(c1["entry_price"] - 1.106666666) < 1e-6
    assert c1["pnl"] == 1500.0
    assert c1["commissions"] == 6.0
    
    # Cluster 2 (Trade 3)
    c2 = clustered.row(1, named=True)
    assert c2["lot_size"] == 1.0
    assert c2["entry_time"] == t3
    assert c2["entry_price"] == 1.1200
    assert c2["pnl"] == 500.0

def test_daily_drawdown_reset():
    # 22:00 UTC boundary check.
    # Day 1: 2026-01-01 21:00 (shifted maps to 2026-01-01)
    # Day 2: 2026-01-01 22:00 (shifted maps to 2026-01-02)
    t_day1 = datetime(2026, 1, 1, 21, 0, 0, tzinfo=timezone.utc)
    t_day2_start = datetime(2026, 1, 1, 22, 0, 0, tzinfo=timezone.utc)
    t_day2_breach = datetime(2026, 1, 1, 23, 0, 0, tzinfo=timezone.utc)
    
    # Starting balance = 10000.
    # On Day 2, we start with balance = 10200, equity = 10100 -> Day 2 ref = 10200.
    # Day 2 floor is 10200 - 306 = 9894.
    # If equity drops to 9890, it should breach.
    equity_curve = pl.DataFrame([
        {"timestamp": t_day1, "balance": 10000.0, "equity": 10000.0},
        {"timestamp": t_day2_start, "balance": 10200.0, "equity": 10100.0},
        {"timestamp": t_day2_breach, "balance": 10200.0, "equity": 9890.0} # daily breach (9890 < 9894)
    ])
    
    trade_log = pl.DataFrame(schema={
        "symbol": pl.String, "direction": pl.String, "lot_size": pl.Float64,
        "entry_time": pl.Datetime(time_unit="us", time_zone="UTC"), "entry_price": pl.Float64,
        "exit_time": pl.Datetime(time_unit="us", time_zone="UTC"), "exit_price": pl.Float64,
        "pnl": pl.Float64, "commissions": pl.Float64, "exit_reason": pl.String
    })
    
    eval_eng = EvaluationEngine(rule_config={"starting_balance": 10000.0})
    result = eval_eng.evaluate(trade_log, equity_curve)
    
    assert result["breached"] is True
    assert result["breach_reason"] == "daily_drawdown_breach"

def test_evaluation_heuristics():
    # 1. 80% profit concentration test
    t1 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 1, 2, 12, 0, 0, tzinfo=timezone.utc)
    t3 = datetime(2026, 1, 3, 12, 0, 0, tzinfo=timezone.utc)
    
    trade_log = pl.DataFrame([
        {
            "symbol": "EURUSD", "direction": "BUY", "lot_size": 1.0,
            "entry_time": t1, "entry_price": 1.1000,
            "exit_time": t1 + timedelta(hours=1), "exit_price": 1.1050,
            "pnl": 500.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        },
        {
            "symbol": "EURUSD", "direction": "BUY", "lot_size": 1.0,
            "entry_time": t2, "entry_price": 1.1000,
            "exit_time": t2 + timedelta(hours=1), "exit_price": 1.1005,
            "pnl": 50.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        }
    ])
    
    equity_curve = pl.DataFrame([
        {"timestamp": t1, "balance": 10000.0, "equity": 10000.0},
        {"timestamp": t2, "balance": 10500.0, "equity": 10500.0},
        {"timestamp": t3, "balance": 10550.0, "equity": 10550.0}
    ])
    
    eval_eng = EvaluationEngine(rule_config={"starting_balance": 10000.0})
    result = eval_eng.evaluate(trade_log, equity_curve)
    
    # Total wins = 550. Max trade profit = 500. Concentration = 500/550 = 90.9% (>=80%)
    assert "single_trade_dependency" in result["flags"]

    # 2. Inactivity test (30 days inactivity)
    t_inactive_entry = t2 + timedelta(days=32)
    trade_log_inactive = pl.DataFrame([
        {
            "symbol": "EURUSD", "direction": "BUY", "lot_size": 1.0,
            "entry_time": t1, "entry_price": 1.1000,
            "exit_time": t1 + timedelta(hours=1), "exit_price": 1.1050,
            "pnl": 500.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        },
        {
            "symbol": "EURUSD", "direction": "BUY", "lot_size": 1.0,
            "entry_time": t_inactive_entry, "entry_price": 1.1000,
            "exit_time": t_inactive_entry + timedelta(hours=1), "exit_price": 1.1005,
            "pnl": 50.0, "commissions": 2.0, "exit_reason": "SIGNAL"
        }
    ])
    
    equity_curve_inactive = pl.DataFrame([
        {"timestamp": t1, "balance": 10000.0, "equity": 10000.0},
        {"timestamp": t_inactive_entry, "balance": 10550.0, "equity": 10550.0}
    ])
    
    result_inactive = eval_eng.evaluate(trade_log_inactive, equity_curve_inactive)
    assert "inactive_account" in result_inactive["flags"]
