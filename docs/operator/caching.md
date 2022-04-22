# Table of Contents

* [Overview](#overview)
  * [What Is Cache?](#what-is-cache)
  * [How CM Uses Caching](#how-cm-uses-caching)
    * [Reddit API Calls](#reddit-api-calls)
    * [Rules and Filters](#rules-and-filters)
* [Configuration](#configuration)
  * [Cache Provider](#cache-provider)

# Overview

**Caching** is a major factor in CM's performance and optimization of Reddit API usage. Leveraging caching effectively in your operator configuration and in individual subreddit configurations can make or break your CM instance.

### What Is Cache?

A **Cache** is a storage medium with high **write** and **read** speed that is generally used to store **temporary, but frequently accessed data.**

## How CM Uses Caching

CM primarily **caches** two types of data:

### Reddit API Calls

#### How Reddit's API Works

In order to communicate with Reddit to retrieve posts, comments, user information, etc... CM uses API calls. Each API call is composed of a

* **request** -- CM asks Reddit for certain information
* **response** -- Reddit responds with the request information

[Reddit imposes an **api quota**](https://github.com/reddit-archive/reddit/wiki/API#rules) on every **individual account** using the API through an application. This quota is **600 requests per 10 minutes.** At the end of the 10 minutes period the quota is reset.

Additionally, some API calls have limits on how much data they can return. The most relevant of these is **user history can only be returned 100 activities (submission/comments) per API call**. EX if you want to get **500** activities from a user's history you will need to make **5** api calls.

#### Caching API Responses

In order to most effectively use the limited quota of API calls CM will **automatically cache API responses based on the "fingerprint" of the request sent.**

On an individual "item" basis that means these resources are always cached:

* General user information (name, karma, age, profile description, etc..)
* General subreddit information (name, nsfw, quarantined, etc...)
* Individually processed activities (comment body, is comment author op, submission title, reports, link, etc...)

Additionally (and most importantly), responses for **user history** are cached **based on what was requested**. Example "fingerprint":

* username
* type of activities to retrieve (overview, only submissions, only comments)
* range of activities to retrieve (last 100, last 6 months, etc...)

If the above "fingerprint" is used in three different Rules then

* First fingerprint appearance -> CM make API call and caches response
* Second fingerprint appearance -> CM uses cached response
* Third fingerprint appearance -> CM uses cached response

So only **one** API call is made even though the history is used three times.

It is therefore **important to re-use window criteria** wherever possible to take advantage of this caching.

### Rules and Filters

Once CM has processed a Rule or Filter (`itemIs` or `authorIs`) the results of that component is stored in cache. For Rules the result is stored for the lifecycle of the Activity being processed and then discarded. For Filters the result is stored for a short time in cache and can be re-used by other Activities.

Re-using Rules and Filters by either using the exact same configuration or by using **names** provides:

* A major performance benefit since these do not need to be re-calculated
* A low-to-medium optimization on API caching, depending on what criteria are being tested.

In general re-use should always be a goal.

# Configuration

## Cache Provider

CM supports two cache **providers**. By default all providers use `memory`:

* `memory` -- in-memory (non-persistent) backend
  * Cache will be lost when CM is restarted/exits
* `redis` -- [Redis](https://redis.io/) backend

Each `provider` object in configuration can be specified as:

* one of the above **strings** to use the **defaults settings** or
* an **object** with keys to override default settings

[Refer to full documentation on cache providers in the schema](https://json-schema.app/view/%23/%23%2Fdefinitions%2FOperatorCacheConfig/%23%2Fdefinitions%2FCacheOptions?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

Some examples:

```json5
{
 "provider": {
   "store": "memory", // one of "memory" or "redis"
   "ttl": 60, // the default max age of a key in seconds
   "max": 500, // the maximum number of keys in the cache (for "memory" only)
   
   // the below properties only apply to 'redis' provider
   "host": 'localhost',
   "port": 6379,
   "auth_pass": null,
   "db": 0,
 }
}
```

YAML

```yaml
provider:
  store: redis
  ttl: 60
  max: 500
  host: localhost
  port: 6379
  auth_pass: null
  db: 0
```

Providers can be specified in multiple locations, with each more specific location overriding the parent-level config:

* top-level config
* in individual bot configurations
* in the web config

```yaml
operator:
 name: example
# top level
caching:
 provider:
  ...
bots:
  - name: u/MyBot
    # overrides top level
    caching:
     provider:
      ...
web:
  # overrides top level
  caching:
    provider:
     ...
```

## Cache TTL

The **Time To Live (TTL)** -- how long data may live in the cache before "expiring" -- can be controlled indepedently for different data types. Sane defaults are provided for all types but tweaking these can improve API caching optimization depending on the subreddit's configuration (use case).

Each of these can be specified in the `caching` property. TTL is measured in seconds.

* `authorTTL` (default 60) -- user activity (overview, submissions, comments)
* `commentTTL` (default 60) -- individually fetched comments
* `submissionTTL` (default 60) -- individually fetched submissions
* `filterCriteriaTTL` (default 60) -- filter results (`itemIs` and `authorIs`)
* `selfTTL` (default 60) -- actions performed by the bot (creating comment reply, report). If action is in cache the bot ignores it if found during polling.
  * This helps prevent bot from reacting to things it did itself IE you don't want it to remove a comment because it reported the comment itself
* `subredditTTL` (default 60) -- general information on fetched subreddit
* `userNotesTTL` (default 300) -- Amount of time [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) are cached
* `wikiTTL` (default 300) -- Wiki pages used for content (in messages, reports, bans, etc...) are cached for this amount of time
