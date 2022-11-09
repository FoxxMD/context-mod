---
nav_order: 6
---

# Development

TODO add more development sections...

# Developing/Testing Github Actions

Use [act](https://github.com/nektos/act) to run Github actions locally.

An example secrets file can be found in the project working directory at [act.env.example](act.env.example)

Modify [push-hook-sample.json](.github/push-hook-sample.json) to point to the local branch you want to run a `push` event trigger on, then run this command from the project working directory:

```bash
act -e .github/push-hook-sample.json --secret-file act.env
```

# Mocking Reddit API

Using [MockServer](https://www.mock-server.com/)

## Installation

https://www.mock-server.com/mock_server/running_mock_server.html

Easiest way is to install the [docker container](https://www.mock-server.com/mock_server/running_mock_server.html#pull_docker_image) ([from here](https://hub.docker.com/r/mockserver/mockserver))

Map port `1080:1080` -- acts as both the proxy port and the UI endpoint with the below URL:

```
http(s)://localhost:1080/mockserver/dashboard
```

In your [operator configuration](/docs/operator/operatorConfiguration.md) define a proxy for snoowrap at the top-level:

```yaml
snoowrap:
  proxy: 'http://localhost:8010'
  #debug: true # optionally set debug to true to make snoowrap requests output to log
```

## Usage

### Forwarding Requests (Monitoring Behavior)

This is what will make MockServer act as an actual **proxy server**. In this state CM will operate normally. In the MockServer UI you will be able to monitor all requests/responses made.

```HTTP
PUT /mockserver/expectation HTTP/1.1
Host: localhost:8010
Content-Type: application/json
Content-Length: 155

{
    "httpRequest": {},
    "priority": 0,
    "httpForward": {
        "host": "oauth.reddit.com",
        "port": 443,
        "scheme": "HTTPS"
    }
}
```

<details>
<summary>CURL</summary>

```bash
curl --location --request PUT 'http://localhost:8010/mockserver/expectation' \
--header 'Content-Type: application/json' \
--data-raw '{
    "httpRequest": {},
    "priority": 0,
    "httpForward": {
        "host": "oauth.reddit.com",
        "port": 443,
        "scheme": "HTTPS"
    }
}'
```

</details>

### Mocking Network Issues

MockServer is a bit confusing and regex'ing for specific paths don't work well (for me??)

The lifecycle of a mock call I do:

* Make sure [forwarding](#forwarding-requests-monitoring-behavior) is set, to begin with
* Breakpoint before the code you want to test with mocking
* [Mock the network issue](#create-network-issue-behavior)
* Once the mock behavior should be "done" then
  * [Clear all exceptions](#clearing-behavior)
  * Set [forwarding behavior](#forwarding-requests-monitoring-behavior) again

### Create Network Issue Behavior

#### All Responses return 403

<details>
<summary>HTTP</summary>

```HTTP
PUT /mockserver/expectation HTTP/1.1
Host: localhost:8010
Content-Type: application/json
Content-Length: 1757

{
    "id": "error",
    "httpRequest": {
        "path": ".*"
    },
    "priority": 1,
    "httpResponse": {
        "statusCode": 403,
        "reasonPhrase": "Forbidden",
        "headers": {
            "Connection": [
                "keep-alive"
            ],
            "Content-Type": [
                "application/json; charset=UTF-8"
            ],
            "x-ua-compatible": [
                "IE=edge"
            ],
            "x-frame-options": [
                "SAMEORIGIN"
            ],
            "x-content-type-options": [
                "nosniff"
            ],
            "x-xss-protection": [
                "1; mode=block"
            ],
            "expires": [
                "-1"
            ],
            "cache-control": [
                "private, s-maxage=0, max-age=0, must-revalidate, no-store, max-age=0, must-revalidate"
            ],
            "x-ratelimit-remaining": [
                "575.0"
            ],
            "x-ratelimit-used": [
                "25"
            ],
            "x-ratelimit-reset": [
                "143"
            ],
            "X-Moose": [
                "majestic"
            ],
            "Accept-Ranges": [
                "bytes"
            ],
            "Date": [
                "Wed, 05 Jan 2022 14:37:37 GMT"
            ],
            "Via": [
                "1.1 varnish"
            ],
            "Vary": [
                "accept-encoding"
            ],
            "Strict-Transport-Security": [
                "max-age=15552000; includeSubDomains; preload"
            ],
            "Server": [
                "snooserv"
            ],
            "X-Clacks-Overhead": [
                "GNU Terry Pratchett"
            ]
        }
    }
}
```

</details>

<details>
<summary>CURL</summary>

```bash
curl --location --request PUT 'http://localhost:8010/mockserver/expectation' \
--header 'Content-Type: application/json' \
--data-raw '{
    "id": "error",
    "httpRequest": {
        "path": ".*"
    },
    "priority": 1,
    "httpResponse": {
        "statusCode": 403,
        "reasonPhrase": "Forbidden",
        "headers": {
            "Connection": [
                "keep-alive"
            ],
            "Content-Type": [
                "application/json; charset=UTF-8"
            ],
            "x-ua-compatible": [
                "IE=edge"
            ],
            "x-frame-options": [
                "SAMEORIGIN"
            ],
            "x-content-type-options": [
                "nosniff"
            ],
            "x-xss-protection": [
                "1; mode=block"
            ],
            "expires": [
                "-1"
            ],
            "cache-control": [
                "private, s-maxage=0, max-age=0, must-revalidate, no-store, max-age=0, must-revalidate"
            ],
            "x-ratelimit-remaining": [
                "575.0"
            ],
            "x-ratelimit-used": [
                "25"
            ],
            "x-ratelimit-reset": [
                "143"
            ],
            "X-Moose": [
                "majestic"
            ],
            "Accept-Ranges": [
                "bytes"
            ],
            "Date": [
                "Wed, 05 Jan 2022 14:37:37 GMT"
            ],
            "Via": [
                "1.1 varnish"
            ],
            "Vary": [
                "accept-encoding"
            ],
            "Strict-Transport-Security": [
                "max-age=15552000; includeSubDomains; preload"
            ],
            "Server": [
                "snooserv"
            ],
            "X-Clacks-Overhead": [
                "GNU Terry Pratchett"
            ]
        }
    }
}'
```

</details>

#### All Responses Timeout

<details>
<summary>HTTP</summary>

```HTTP
PUT /mockserver/expectation HTTP/1.1
Host: localhost:8010
Content-Type: application/json
Content-Length: 251

{
    "id": "error",
    "httpRequest": {
        "path": ".*"
    },
    "priority": 1,
    "httpResponse": {
        "body": "should never receive this",
        "delay": {
            "timeUnit": "SECONDS",
            "value": 60
        }
    }
}
```

</details>

<details>
<summary>CURL</summary>

```bash
curl --location --request PUT 'http://localhost:8010/mockserver/expectation' \
--header 'Content-Type: application/json' \
--data-raw '{
    "id": "error",
    "httpRequest": {
        "path": ".*"
    },
    "priority": 1,
    "httpResponse": {
        "body": "should never receive this",
        "delay": {
            "timeUnit": "SECONDS",
            "value": 60
        }
    }
}'
```

</details>

#### All Responses Drop After Delay (Connection Closed by Server)

<details>
<summary>HTTP</summary>

```HTTP
PUT /mockserver/expectation HTTP/1.1
Host: localhost:8010
Content-Type: application/json
Content-Length: 234

{
    "id": "error",
    "httpRequest": {
        "path": ".*"
    },
    "priority": 1,
    "httpError": {
        "dropConnection": true,
        "delay": {
            "timeUnit": "SECONDS",
            "value": 2
        }
    }
}
```

</details>

<details>
<summary>CURL</summary>

```bash
curl --location --request PUT 'http://localhost:8010/mockserver/expectation' \
--header 'Content-Type: application/json' \
--data-raw '{
    "id": "error",
    "httpRequest": {
        "path": ".*"
    },
    "priority": 1,
    "httpError": {
        "dropConnection": true,
        "delay": {
            "timeUnit": "SECONDS",
            "value": 2
        }
    }
}'
```

</details>

### Clearing Behavior


```HTTP
PUT /mockserver/clear?type=EXPECTATIONS HTTP/1.1
Host: localhost:8010
Content-Type: application/json
Content-Length: 26

{
    "path": "/user/.*"
}
```

<details>
<summary>CURL</summary>

```bash
curl --location --request PUT 'http://localhost:8010/mockserver/clear?type=EXPECTATIONS' \
--header 'Content-Type: application/json' \
--data-raw '{
    "path": "/.*"
}'
```

</details>
