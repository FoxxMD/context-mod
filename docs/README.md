# Documentation

# Table of Contents

* [Getting Started](#getting-started)
* [How It Works](#how-it-works)
* [Concepts](#concepts)
  * [Event](#event)
  * [Activity](#activity)
  * [Run](#runs)
  * [Check](#checks)
  * [Rule](#rule)
    * [Available Rules](#available-rules)
  * [Rule Set](#rule-set)
  * [Action](#action)
    * [Available Actions](#available-actions)
  * [Filters](#filters)
* [Configuration and Usage](#configuration-and-usage)
* FAQ

## Getting Started

Review **at least** the **How It Works** and **Concepts** below, then:

* For **Operators** (running a bot instance) refer to [**Operator Getting Started**](/docs/operator/gettingStarted.md)  guide
* For **Moderators** (configuring an existing bot for your subreddit) refer to the [**Moderator Getting Started**](/docs/gettingStartedMod.md) guide

## How It Works

Where possible Context Mod (CM) uses the same terminology as, and emulates the behavior, of **automoderator** so if you are familiar with that much of this may seem familiar to you.

### Diagram

Expand the section below for a simplified flow diagram of how CM processes an incoming Activity. Then refer the text description of the diagram below as well as [Concepts](#Concepts) for descriptions of individual components.

<details>
<summary>Diagram</summary>

![Flow Diagram](/docs/images/diagram-highlevel.jpg)

</details>

CM's lifecycle looks like this:

#### 1) A new Activity in your subreddit is received by CM

The Activities CM watches for are configured by you. These can be new modqueue/unmoderated items, submissions, or comments.

#### 2) CM sequentially processes each Run in your configuration

A [**Run**](#Runs) is made up of a set of [**Checks**](#Checks)

#### 3) CM sequentially processes each Check in the current Run

A **Check** is a set of:

* One or more [**Rules**](#Rule) that define what conditions should **trigger** this Check
* One or more [**Actions**](#Action) that define what the bot should do once the Check is **triggered**

#### 4) Each Check is processed, *in order*, until a Check is **triggered**

In CM's default configuration, once a Check is **triggered** no more Checks will be processed. This means all subsequent Checks in this Run (in the order you listed them) are skipped.

#### 5) All Actions from the triggered Check are executed

After all **Actions** from the triggered **Check** are executed CM begins processing the next **Run**

#### 6) Rinse and Repeat from #3

Until all Runs have been processed.

## Concepts

Core, high-level concepts regarding how CM works.

### Event

An **Event** refers to the [Activity](#activity) (Comment or Submission) CM receives to process as well as the results of processing that Activity.

### Activity

An Activity is a Comment or Submission from Reddit.

### Runs

A **Run** is made up of a set of **Checks** that represent a group of related behaviors the bot should check for or perform -- that are independent of any other behaviors the Bot should perform.

An example of Runs:

* A group of Checks that look for missing flairs on a user or a new submission and flair accordingly
* A group of Checks that detect spam or self-promotion and then remove those activities

Both group of Checks are independent of each other (don't have any patterns or actions in common).

[Full Documentation for Runs](/docs/components/README.md#runs)

### Checks

A **Check** is the main logical unit of behavior for the bot. It is equivalent to "if X then Y". A Check is composed of:

* One or more **Rules** that are tested against an **Activity**
* One of more **Actions** that are performed when the **Rules** are satisfied

A Run can be made up of one or more **Checks** that are processed **in the order they are listed in the Run.**

Once a Check is **triggered** (its Rules are satisfied and Actions performed) all subsequent Checks are skipped.

[Full Documentation for Checks](/docs/components/README.md#checks)
  
### Rule

A **Rule** is some set of **criteria** (conditions) that are tested against an Activity (comment/submission), a User, or a User's history. A Rule is considered **triggered** when the **criteria** for that rule are found to be **true** for whatever is being tested against.

CM has different **Rules** that can test against different types of behavior and aspects of a User, their history, and the Activity (submission/common) being checked.

[Full Documentation for Rules](/docs/components/README.md#rules)

#### Available Rules

All available rules can be found in the [components documentation](/docs/components/README.md#rules)

### Rule Set

A **Rule Set** is a "grouped" set of `Rules` with a **trigger condition** specified. 

Rule Sets can be used interchangeably with other **Rules** and **Rule Sets** in the `rules` list of a **Check**. 

They allow you to create more complex trigger behavior by combining multiple rules into one "parent rule".

[Rule Sets Documentation](/docs/components/README.md#rule-sets)

### Action

An **Action** is some action the bot can take against the checked Activity (comment/submission) or Author of the Activity. CM has Actions for most things a normal reddit user or moderator can do.

#### Available Actions

[Available Actions Documentation](/docs/components/README.md#list-of-actions)

### Filters

**Runs, Checks, Rules, and Actions** all have two additional (optional) criteria "pre-tests". These tests are different from rules/checks in these ways:

* Filters test against the **current state** of the Activity (or it's Author) being processed, rather than looking at history/context/etc...
* Filter test results only determine if the Run, Check, Rule, or Action **should run** -- rather than triggering it
  * When the filter test **passes** the thing being tested continues to process as usual
  * When the filter test **fails** the thing being tested **fails**.

[Full Documentation for Filters](/docs/components/README.md#filters)

## Configuration And Usage

* For **Operator/Bot maintainers** see **[Operation Guide](/docs/operator/README.md)**
* For **Moderators** 
  * Refer to the [Subreddit Components Documentation](/docs/components) or the [subreddit-ready examples](/docs/components/subredditReady)
  * as well as the [schema](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) which has
    * fully annotated configuration data/structure
    * generated examples in json/yaml

## FAQ

TODO
