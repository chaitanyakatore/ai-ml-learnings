# Cross Validation

**Date:** May 17, 2026  
**Category:** Machine Learning → Model Evaluation

---

# What is Cross Validation?

Cross-validation is a statistical technique used to evaluate how well a machine learning model generalizes to unseen data.

Instead of training the model once on a single train-test split:

```text
Train Once → Test Once
```

Cross-validation trains and evaluates the model multiple times on different subsets of the dataset.

The final model performance is usually calculated by averaging all validation scores.

---

# Why Do We Need Cross Validation?

A single train-test split may give unreliable results because:

- Test set may be too easy
- Test set may be too hard
- Small datasets lose important training data
- Results vary significantly based on random split

---

## Example Problem

Suppose we have:

- Dataset size = 100 rows

### Split 1

```text
Train = 80 rows
Test = 20 rows

Accuracy = 95%
```

---

### Split 2

```text
Train = 80 rows
Test = 20 rows

Accuracy = 82%
```

Huge variation → unreliable model evaluation.

Cross-validation solves this by testing multiple splits.

---

# How Cross Validation Works

Dataset:

```text
1000 rows
```

Split into multiple subsets (folds)

Train model multiple times

Validate model multiple times

Take average performance

---

# K-Fold Cross Validation

This is the most commonly used cross-validation technique.

Suppose:

```text
k = 5
```

Dataset is divided into:

```text
Fold 1
Fold 2
Fold 3
Fold 4
Fold 5
```

---

## Iteration 1

Training:

```text
Fold 2 + Fold 3 + Fold 4 + Fold 5
```

Validation:

```text
Fold 1
```

---

## Iteration 2

Training:

```text
Fold 1 + Fold 3 + Fold 4 + Fold 5
```

Validation:

```text
Fold 2
```

---

## Iteration 3

Training:

```text
Fold 1 + Fold 2 + Fold 4 + Fold 5
```

Validation:

```text
Fold 3
```

---

## Iteration 4

Training:

```text
Fold 1 + Fold 2 + Fold 3 + Fold 5
```

Validation:

```text
Fold 4
```

---

## Iteration 5

Training:

```text
Fold 1 + Fold 2 + Fold 3 + Fold 4
```

Validation:

```text
Fold 5
```

---

## Final Performance

```text
Accuracy Scores:
92%
90%
89%
91%
88%
```

Final Accuracy:

```text
Average = 90%
```

---

# Types of Cross Validation

---

# 1. K-Fold Cross Validation

### Definition

Dataset is divided into K equal folds.

Each fold gets one chance to act as validation data.

---

### Use Cases

- General ML problems
- Regression
- Classification

---

### Advantages

- Reliable
- Simple
- Widely used

---

### Disadvantages

- Slower than train-test split

---

# 2. Stratified K-Fold Cross Validation

Used when dataset is imbalanced.

Example:

```text
90% Negative class
10% Positive class
```

Normal K-Fold may create folds with uneven distribution.

Stratified K-Fold ensures every fold maintains same class ratio.

---

## Example

```text
Each fold:
90% Negative
10% Positive
```

---

## Use Cases

- Fraud detection
- Medical diagnosis
- Spam detection

---

## Why Important?

Prevents biased evaluation.

---

# 3. Leave One Out Cross Validation (LOOCV)

If dataset contains:

```text
n samples
```

Train on:

```text
n-1 samples
```

Validate on:

```text
1 sample
```

Repeat this process `n` times.

---

## Example

100 rows:

```text
Train → 99
Test → 1
```

Repeat 100 times.

---

## Advantages

- Maximum training data usage

---

## Disadvantages

- Extremely slow
- Computationally expensive

---

## Use Cases

Small datasets

---

# 4. Leave P Out Cross Validation

Instead of leaving one sample:

Leave P samples out.

Example:

```text
Leave 2 samples
Train on remaining samples
```

Repeat for multiple combinations.

---

## Problem

Very expensive computation.

---

# 5. Repeated K-Fold Cross Validation

K-Fold repeated multiple times using different random splits.

Example:

```text
5-Fold repeated 10 times
```

---

## Why use?

Provides more robust performance estimates.

---

# 6. Time Series Cross Validation

Used when working with sequential/time-dependent data.

Example:

- Stock prediction
- Sales forecasting
- Weather forecasting

---

## Wrong Approach

```text
Future data → Training
Past data → Testing
```

This causes data leakage.

---

## Correct Approach

```text
Train: Jan → March
Test: April
```

Then:

```text
Train: Jan → April
Test: May
```

---

# 7. Nested Cross Validation

Used for:

- Hyperparameter tuning
- Model selection

---

## Structure

Outer loop:

```text
Model evaluation
```

Inner loop:

```text
Hyperparameter tuning
```

---

## Why Use It?

Prevents data leakage during tuning.

---

# Advantages of Cross Validation

- Better generalization estimate
- Reduces overfitting risk
- Better for smaller datasets
- Helps in hyperparameter tuning
- Reliable model evaluation

---

# Disadvantages of Cross Validation

- Computationally expensive
- Slower for large datasets
- Hard to use for huge deep learning models

---

# Cross Validation vs Train Test Split

| Train-Test Split       | Cross Validation        |
| ---------------------- | ----------------------- |
| Faster                 | Slower                  |
| Less reliable          | More reliable           |
| Single evaluation      | Multiple evaluations    |
| Good for huge datasets | Good for small datasets |

---

# Real World Usage

Cross-validation is commonly used in:

- GridSearchCV
- RandomSearchCV
- Hyperparameter tuning
- Model comparison
- Production validation

---

# Python Example

```python
from sklearn.model_selection import cross_val_score
from sklearn.linear_model import LogisticRegression

model = LogisticRegression()

scores = cross_val_score(
    model,
    X,
    y,
    cv=5
)

print(scores)
print(scores.mean())
```

---

# Interview Questions

### Why use cross validation instead of train-test split?

---

### Difference between K-Fold and Stratified K-Fold?

---

### Why is LOOCV expensive?

---

### Why can't we use normal K-Fold for time series?

---

### What is Nested Cross Validation?

---

# Key Takeaways

- Cross-validation improves reliability of model evaluation
- K-Fold is most commonly used
- Stratified K-Fold handles class imbalance
- Time Series CV prevents data leakage
- LOOCV is useful for small datasets
- Nested CV is used for hyperparameter tuning
