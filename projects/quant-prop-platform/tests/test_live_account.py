import polars as pl
from datetime import datetime, timezone, timedelta
from quantprop.evaluation.live_account import LiveAccountSimulator

def test_payout_biweekly_split_and_resets():
    # Setup timeline: Jan 5, 2026 is Monday.
    # 1st Wednesday is Jan 7.
    # 2nd Wednesday (1st review) is Jan 14.
    start = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)
    
    # Create equity curve
    curve_data = []
    # Day 0 (Monday Jan 5) to Day 10 (Jan 15)
    for i in range(15):
        day_time = start + timedelta(days=i)
        # Rises to 10500 on Jan 14 (i=9)
        balance = 10000.0
        if i >= 9:
            balance = 10500.0
            
        curve_data.append({
            "timestamp": day_time,
            "balance": balance,
            "equity": balance
        })
        
    df_curve = pl.DataFrame(curve_data)
    df_trades = pl.DataFrame([]) # no trade list needed for basic payout check
    
    # Biweekly simulator (default split = 80%)
    simulator = LiveAccountSimulator(starting_balance=10000.0, payout_schedule="biweekly")
    res = simulator.simulate_payouts(df_trades, df_curve)
    
    assert not res["breached"]
    assert len(res["payouts"]) == 1
    
    payout = res["payouts"][0]
    assert payout["net_profit"] == 500.0
    assert payout["trader_payout"] == 400.0 # 80% of 500
    assert abs(payout["firm_payout"] - 100.0) < 1e-6 # 20% of 500
    assert payout["balance_before"] == 10500.0
    assert payout["balance_after"] == 10000.0
    
    # Check adjusted curve resets
    adjusted_curve = res["adjusted_equity_curve"]
    # Check that after payout (Jan 14 and 15), balance is reset to 10000.0
    for row in adjusted_curve.to_dicts():
        if row["timestamp"].date() >= datetime(2026, 1, 14).date():
            assert row["balance"] == 10000.0

def test_payout_threshold_rollover():
    # Start Monday Jan 5. First Wednesday Jan 7. Second Wednesday Jan 14. Third Wednesday Jan 21. Fourth Wednesday Jan 28.
    start = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)
    
    curve_data = []
    for i in range(25):
        day_time = start + timedelta(days=i)
        # i=9 (Jan 14): balance is 10050 (below 1% threshold of 100.0)
        # i=23 (Jan 28): balance is 10300 (above threshold)
        balance = 10000.0
        if i >= 23:
            balance = 10300.0
        elif i >= 9:
            balance = 10050.0
            
        curve_data.append({
            "timestamp": day_time,
            "balance": balance,
            "equity": balance
        })
        
    df_curve = pl.DataFrame(curve_data)
    df_trades = pl.DataFrame([])
    
    # Biweekly simulator
    simulator = LiveAccountSimulator(starting_balance=10000.0, payout_schedule="biweekly")
    res = simulator.simulate_payouts(df_trades, df_curve)
    
    assert not res["breached"]
    # Should skip Jan 14 (below 1%) and trigger on Jan 28 (first payout review Jan 14, second Jan 28)
    assert len(res["payouts"]) == 1
    payout = res["payouts"][0]
    assert payout["net_profit"] == 300.0
    assert payout["trader_payout"] == 240.0

def test_payout_breach_termination():
    # Setup timeline: Jan 5 Monday.
    # Slow bleed to overall drawdown breach without triggering daily drawdown limit.
    # Daily limit: 3% of 10000 = 300. We drop by 200 per day.
    # overall floor: 9400.
    start = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)
    
    curve_data = []
    prices = [10000.0, 9800.0, 9600.0, 9350.0, 9350.0, 9350.0]
    for i, price in enumerate(prices):
        day_time = start + timedelta(days=i)
        curve_data.append({
            "timestamp": day_time,
            "balance": price,
            "equity": price
        })
        
    df_curve = pl.DataFrame(curve_data)
    df_trades = pl.DataFrame([])
    
    simulator = LiveAccountSimulator(starting_balance=10000.0, payout_schedule="biweekly")
    res = simulator.simulate_payouts(df_trades, df_curve)
    
    assert res["breached"]
    assert res["breach_reason"] == "overall_drawdown_breach"
    # Merges/payouts lists should be empty since account was terminated before Jan 14 review
    assert len(res["payouts"]) == 0
