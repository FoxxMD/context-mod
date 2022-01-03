# Activity Window

Most **Rules** have a `window` property somewhere within their configuration. This property defines the range of **Activities** (submission and/or comments) that should be retrieved for checking the criteria of the Rule.

As an example if you want to run an **Recent Activity Rule** to check if a user has had activity in /r/mealtimevideos you also need to define what range of activities you want to look at from that user's history.

## `window` property overview (tldr)

The value of `window` can be any of these types:

* `number` count of activities
* `string` [duration](#duration-string-recommended) or [iso 8601](#an-iso-8601-duration-string)
* [duration `object`](#duration-object)
* [ActivityWindowCriteria `object`](#activitywindowcriteria)

Examples of all of the above

<details>

```yaml
# count, last 100 activities
window: 100

# duration, last 10 days
window: 10 days

# duration object, last 2 months and 5 days
window:
  months: 2
  days: 5

# iso 8601 string, last 15 minutes
window: PT15M

# ActivityWindowCriteria, last 100 activities or 6 weeks of activities (whichever is found first)
window:
  count: 100
  duration: 6 weeks
```

```json5
// count, last 100 activities
{
  "window": 100
}

// duration string, last 10 days
{
  "window": "10 days"
}

// duration object, last 2 months and 5 days
{
  "window": {
    "months": 2,
    "days": 5,
  }
}

// iso 8601 string, last 15 minutes
{
  "window": "PT15M"
}

// ActivityWindowCriteria, last 100 activities or 6 weeks of activities (whichever is found first)
{
  "window": {
    "count": 100,
    "duration": "6 weeks"
  }
}
```

</details>

## Types of Ranges

There are two types of values that can be used when defining a range:

### Count

This is the **number** of activities you want to retrieve. It's straightforward -- if you want to look at the last 100 activities for a user you can use `100` as the value.

### Duration

A **duration of time** between which all activities will be retrieved. This is a **relative value** that calculates the actual range based on **the duration of time subtracted from when the rule is run.**

For example:

* Today is **July 15th**
* You define a duration of **10 days**

Then the range of activities to be retrieved will be between **July 5th and July 15th** (10 days).

#### Duration Values

The value used to define the duration can be **any of these three types**:

##### Duration String (recommended)

A string consisting of

* A [Dayjs unit of time](https://day.js.org/docs/en/durations/creating#list-of-all-available-units)
* The value of that unit of time

Examples:

* `9 days`
* `14 hours`
* `80 seconds`

You can ensure your string is valid by testing it [here.](https://regexr.com/61em3)

##### Duration Object

If you need to specify multiple units of time for your duration you can instead provide a [Dayjs duration **object**](https://day.js.org/docs/en/durations/creating#list-of-all-available-units) consisting of Dayjs unit-values.

Example

JSON
```json
{
  "days": 4,
  "hours": 6,
  "minutes": 20
}
```
YAML
```yaml
window:
  days: 4
  hours: 6
  minutes: 20
```

##### An ISO 8601 duration string

If you're a real nerd you can also use a [standard duration](https://en.wikipedia.org/wiki/ISO_8601#Durations)) string.

Examples

* `PT15M` (15 minutes)

Ensure your string is valid by testing it [here.](https://regexr.com/61em9)

## ActivityWindowCriteria

This is an object that lets you specify more granular conditions for your range.

The full object looks like this:

JSON
```json
{
  "count": 100,
  "duration": "10 days",
  "satisfyOn": "any",
  "subreddits": {
    "include": ["mealtimevideos","pooptimevideos"],
    "exclude": ["videos"]
  }
}
```
YAML
```yaml
window:
  count: 100
  duration: 10 days
  satisfyOn: any
  subreddits:
    include:
      - mealtimevideos
      - pooptimevideos
    exclude:
      - videos
```

### Specifying Range

You may use **one or both range properties.**

If both range properties are specified then the value `satisfyOn` determines how the final range is determined


#### Using `"satisfyOn": "any"` (default)

If **any** then Activities will be retrieved until one of the range properties is met, **whichever occurs first.**

Example

JSON
```json
{
  "count": 80,
  "duration": "90 days",
  "satisfyOn": "any"
}
```
YAML
```yaml
window:
  count: 80
  duration: 90 days
  satisfyOn: any
```
Activities are retrieved in chunks of 100 (or `count`, whichever is smaller)

* If 90 days of activities returns only 40 activities => returns 40 activities
* If 80 activities is only 20 days of range => 80 activities

#### Using `"satisfyOn": "all"`

If **all** then both ranges must be satisfied. Effectively, whichever range produces the most Activities will be the one that is used.

Example

JSON
```json
{
  "count": 100,
  "duration": "90 days",
  "satisfyOn": "all"
}
```
YAML
```yaml
window:
  count: 100
  duration: 90 days
  satisfyOn: all
```
Activities are retrieved in chunks of 100 (or `count`, whichever is smaller)

* If at 90 days of activities => 40 activities retrieved
  * continue retrieving results until 100 activities
  * so range is >90 days of activities
* If at 100 activities => 20 days of activities retrieved
  * continue retrieving results until 90 days of range
  * so results in >100 activities

### Filtering Activities

You may filter retrieved Activities using an array of subreddits.

**Note:** Activities are filtered **before** range check is made so you will always end up with specified range (but may require more api calls if many activities are filtered out)

#### Include

Use **include** to specify which subreddits should be included from results

Example where only activities from /r/mealtimevideos and /r/modsupport will be returned

JSON
```json
{
  "count": 100,
  "duration": "90 days",
  "satisfyOn": "any",
  "subreddits": {
    "include": ["mealtimevideos","modsupport"]
  }
}
```
YAML
```yaml
window:
  count: 100
  duruation: 90 days
  satisfyOn: any
  subreddits:
    include:
      - mealtimevideos
      - modsupport
```

#### Exclude

Use **exclude** to specify which subreddits should NOT be in the results

Example where activities from /r/mealtimevideos and /r/modsupport will not be returned in results

JSON
```json
{
  "count": 100,
  "duration": "90 days",
  "satisfyOn": "any",
  "subreddits": {
    "exclude": ["mealtimevideos","modsupport"]
  }
}
```
YAML
```yaml
window:
  count: 100
  duruation: 90 days
  satisfyOn: any
  subreddits:
    exclude:
      - mealtimevideos
      - modsupport
```
**Note:** `exclude` will be ignored if `include` is also present.
