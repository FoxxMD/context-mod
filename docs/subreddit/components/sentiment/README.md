# Table of Contents

* [Overview](#overview)
  * [Pros And Cons](#pros-and-cons)
  * [Technical Overview](#technical-overview)
* [Sentiment Values](#sentiment-values)
* [Usage](#usage)
  * [Testing Sentiment Value](#testing-sentiment-value)
    * [Numerical](#numerical)
    * [Text](#text)
  * [Sentiment Rule](#sentiment-rule)
    * [Historical](#historical)
* [Examples](#examples)

# Overview

[Sentiment Analysis](https://monkeylearn.com/sentiment-analysis/) (SA) is a form of [Natural Language Processing](https://monkeylearn.com/natural-language-processing/) (NLP) used to extract the overall [sentiment](https://www.merriam-webster.com/dictionary/sentiment) (emotional intent) from a piece of text. Simply, SA is used to determine how positive or negative the emotion of a sentence is.

Examples:

* "I love how curly your hair is" -- very positive
* "The United States is over 200 years old" -- neutral
* "Frankly, your face is disgusting and I would hate to meet you" -- very negative

SA can be a powerful signal for determining the intent of a user's comment/submission. However, it should not be the **only** tool as it comes with both strengths and weaknesses.

## Pros and Cons

Pros

* In terms of Reddit API usage, SA is **free**. It requires no API calls and is computationally trivial.
* Extremely powerful signal for intent since it analyzes the actual text content of an activity
* Requires almost no setup to use
  * Can be used as a substitute for regex/keyword matching when looking for hateful/toxic comments
* English language comprehension is very thorough
  * Uses 3 independent algorithms to evaluate sentiment
  * Understands common english slang, internet slang, and emojis

Cons

* Language limited -- only supported for English (most thorough), French, German, and Spanish
* Less accurate for small word count content (less than 4 words)
* Does not understand sarcasm/jokes
* Accuracy depends on use of common words
* Accuracy depends on clear intent
  * Heavy nuance, obscure word choice, and hidden meanings are not understood

## Technical Overview

ContextMod attempts to identify the language of the content it is processing. Based on its confidence of the language it will use up to three different NLP libraries to extract sentiment:

* [NLP.js](https://github.com/axa-group/nlp.js/blob/master/docs/v3/sentiment-analysis.md) (english, french, german, and spanish)
* [vaderSentiment-js](https://github.com/vaderSentiment/vaderSentiment-js/) (english only)
* [wink-sentiment](https://github.com/winkjs/wink-sentiment) (english only)

The above libraries make use of these Sentiment Analysis algorithms:

* VADER https://github.com/cjhutto/vaderSentiment
* AFINN http://corpustext.com/reference/sentiment_afinn.html
* Senticon https://ieeexplore.ieee.org/document/8721408
* Pattern https://github.com/clips/pattern
* wink https://github.com/winkjs/wink-sentiment (modified AFINN with emojis)

Each library produces a normalized score: the sum of all the valence values for each recognized token in its lexicon, divided by the number of words/tokens.

ContextMod takes each normalized score and adjusts it to be between -1 and +1. It then adds finds the average of all normalized score to produce a final sentiment between -1 and +1.

# Sentiment Values

Each piece of content ContextMod analyses produces a score from -1 to +1 to represent the sentiment of that content

| Score | Sentiment          |
|-------|--------------------|
| -1    |                    |
| -0.6  | Extremely Negative |
| -0.3  | Very Negative      |
| -0.1  | Negative           |
| 0     | Neutral            |
| 0.1   | Positive           |
| 0.3   | Very Positive      |
| 0.6   | Extremely Positive |
| 1     |                    |

# Usage

## Testing Sentiment Value

Testing for sentiment in the Sentiment Rule is done using either a **text** or **numerical** comparison.

### Numerical

Similar to other numerical comparisons in CM -- use an equality operator and the number to test for:

* `> 0.1` -- sentiment is at least positive
* `<= -0.1` -- sentiment is not negative

Testing for *only* neutral sentiment should be done use a text comparison (below).

### Text

Use any of the **Sentiment** text values from the above table to form a test:

* `is very positive`
* `is neutral`
* `is extremely negative`

You may also use the `not` operator:

* `is not negative`
* `is not very negative`
* `is not neutral`

## Sentiment Rule

An example rule that tests the current comment/submission to see if it has negative sentiment:

```yaml
sentiment: 'is negative'
```

It's very simple :)

### Historical

You may also test the Sentiment of Activities from the user's history. (Note: this may use an API call to get history)

```yaml
sentiment: 'is negative'
historical:
  window:
    count: 50
  mustMatchCurrent: true # optional, the initial activity being tested must test true ("is positive" must be true) before historical tests are run
  sentimentVal: 'is very negative' # optional, if the sentiment test to use for historical content is different than the initial test
  totalMatching: '> 3' # optional, a comparison for how many historical activities must match sentimentVal
```

# Examples

#### Check with Rules for recent problem subreddit activity and negative sentiment in comment

```yaml
name: Probably Toxic Comment
kind: comment
rules:
  - kind: recentActivity
    thresholds:
      - aProblemSubreddit
  - kind: sentiment
    name: negsentiment
    sentiment: 'is very negative'
actions:
  - kind: report
    content: 'Sentiment of {{rules.negsentiment.averageScore}} {{rules.negsentiment.sentimentTest}}'
```

#### Check with Rules for recent problem subreddit activity and negative sentiment in comment history from problem subreddits

```yaml
name: Toxic Comment With History
kind: comment
rules:
  - kind: recentActivity
    thresholds:
      - aProblemSubreddit
      - aSecondProblemSubreddit
  - kind: sentiment
    sentiment: 'is very negative'
    historical:
      sentimentVal: 'is negative'
      mustMatchCurrent: true
      totalMatching: '> 1'
      window:
        count: 100
        filterOn:
          post:
            subreddits:
              include:
                - name:
                  - aProblemSubreddit
                  - aSecondProblemSubreddit
actions:
  - kind: remove
```
