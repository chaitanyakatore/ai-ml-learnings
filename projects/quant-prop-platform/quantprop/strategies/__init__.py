"""
Strategy Layer Module
Responsible for defining core trading strategies and their hypotheses.
"""

from quantprop.strategies.base_strategy import BaseStrategy
from quantprop.strategies.sma_crossover import SMACrossoverStrategy
from quantprop.strategies.rsi_mean_reversion import RSIMeanReversionStrategy
from quantprop.strategies.bb_breakout import BollingerBandsBreakoutStrategy

