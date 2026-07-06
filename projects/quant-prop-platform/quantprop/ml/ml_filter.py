import polars as pl
import pandas as pd
from typing import Dict, Any, List, Optional
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

class MLTradeFilter:
    """
    ML classifier that acts as a pre-trade gatekeeper.
    
    Predicts the probability of a proposed trade's success (profitable close)
    based on market technical features computed at trade entry, blocking
    entries with low probability.
    """
    def __init__(self, model_config: Optional[Dict[str, Any]] = None, random_seed: int = 42):
        self.model_config = model_config or {}
        self.random_seed = random_seed
        
        n_estimators = self.model_config.get("n_estimators", 100)
        max_depth = self.model_config.get("max_depth", 5)
        
        self.model = RandomForestClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            random_state=self.random_seed
        )
        self.feature_names: List[str] = []
        self.feature_importances: Dict[str, float] = {}
        self.test_accuracy: float = 0.0
        self.is_trained = False

    def train(self, features: pl.DataFrame, labels: Any) -> Dict[str, Any]:
        """
        Train the machine learning filter model using a train/test split.
        
        Args:
            features: Polars DataFrame of features calculated at trade entry.
            labels: Polars Series, list, or numpy array of binary win outcomes (1 for profit, 0 for loss).
            
        Returns:
            Dict containing OOS accuracy and feature importances.
        """
        if len(features) < 10:
            raise ValueError(f"Insufficient training data: only {len(features)} samples provided.")
            
        X = features.to_pandas()
        
        # Standardize labels representation
        if isinstance(labels, pl.Series):
            y = labels.to_list()
        else:
            y = list(labels)
            
        y = pd.Series(y)
        
        self.feature_names = list(X.columns)
        
        # Split into Train/Test to calculate OOS validation metric
        # stratify=y checks that the percentage of wins/losses is identical in train/test splits
        X_train, X_test, y_train, y_test = train_test_split(
            X, y,
            test_size=0.3,
            random_state=self.random_seed,
            stratify=y if len(set(y)) > 1 else None
        )
        
        self.model.fit(X_train, y_train)
        
        # Predict on OOS test set
        y_pred = self.model.predict(X_test)
        self.test_accuracy = float(accuracy_score(y_test, y_pred))
        
        # Extract feature importances
        self.feature_importances = {
            name: float(imp) 
            for name, imp in zip(self.feature_names, self.model.feature_importances_)
        }
        
        self.is_trained = True
        
        return {
            "test_accuracy": self.test_accuracy,
            "feature_importances": self.feature_importances
        }

    def should_execute(self, trade_features: Dict[str, Any]) -> float:
        """
        Predict the probability of trade success.
        
        Args:
            trade_features: Dictionary of feature values at the proposed entry point.
            
        Returns:
            Success probability value between 0.0 and 1.0.
        """
        if not self.is_trained:
            raise RuntimeError("MLTradeFilter model has not been trained yet.")
            
        # Ensure keys exist and are in the correct columnar order
        missing = set(self.feature_names) - set(trade_features.keys())
        if missing:
            raise ValueError(f"Missing required trade entry features for prediction: {missing}")
            
        # Construct single row DataFrame matching training columns
        df_row = pd.DataFrame([trade_features], columns=self.feature_names)
        
        # Predict probabilities
        probs = self.model.predict_proba(df_row)[0]
        
        # Locate index of the positive class (1) in model classes
        classes = list(self.model.classes_)
        if 1 in classes:
            win_idx = classes.index(1)
            return float(probs[win_idx])
        return 0.0

