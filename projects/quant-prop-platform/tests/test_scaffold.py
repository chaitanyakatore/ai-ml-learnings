"""
Verify that the project structure is scaffolded correctly and all packages are importable.
"""

def test_imports():
    # Root package
    import quantprop
    
    # Submodules
    from quantprop.data.data_layer import DataLayer
    from quantprop.features.feature_engineering import add_sma, add_atr
    from quantprop.strategies.base_strategy import BaseStrategy
    from quantprop.risk.risk_manager import RiskManager
    from quantprop.backtest.backtester import BacktestEngine
    from quantprop.evaluation.evaluation_engine import EvaluationEngine
    from quantprop.optimization.optimizer import StrategyOptimizer
    from quantprop.ml.ml_filter import MLTradeFilter
    from quantprop.analytics.analytics_reporter import AnalyticsReporter

    # Simple sanity check
    assert quantprop.__version__ == "0.1.0"
    print("All modules imported successfully!")
