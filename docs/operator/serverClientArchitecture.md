---
parent: Operator
---

# Architecture

# Overview

ContextMod's high-level functionality is separated into two **independently run** applications.

Each application consists of an [Express](https://expressjs.com/) web server that executes the core logic for that application and communicates via HTTP API calls:

Applications:

* **Server** -- Responsible for **running the bots** and providing an API to retrieve information on and interact with them EX start/stop bot, reload config, retrieve operational status, etc.
* **Client** -- Responsible for serving the **web interface** and handling the bot oauth authentication flow between operators and moderators.

Both applications operate independently and can be run individually. The determination for which is run is made by environmental variables, operator config, or cli arguments.

# Authentication

Communication between the applications is secured using [Json Web Tokens](https://github.com/mikenicholson/passport-jwt) signed/encoded by a **shared secret** (HMAC algorithm). The secret is defined in the operator configuration.

# Configuration

## Default Mode

**ContextMod is designed to operate in a "monolith" mode by default.**

This is done by assuming that when configuration is provided by **environmental variables or CLI arguments** the user's intention is to run the client/server together with only one bot, as if ContextMod is a monolith application. When using these configuration types the same values are parsed to both the server/client to ensure interoperability/transparent usage for the operator. Some examples of this in the **operator configuration**:

* The **shared secret** for both client/secret cannot be defined using env/cli -- at runtime a random string is generated that is set for the value `secret` on both the `api` and `web` properties.
* The `bots` array cannot be defined using env/cli -- a single entry is generated by the configuration parser using the combined values provided from env/cli
* The `PORT` env/cli argument only applies to the `client` wev server to guarantee the default port for the `server` web server is used (so the `client` can connect to `server`)

**The end result of this default behavior is that an operator who does not care about running multiple CM instances does not need to know or understand anything about the client/server architecture.**

## Server

To run a ContextMod instance as **sever only (headless):**

* Config file -- define top-level `"mode":"server"`
* ENV -- `MODE=server`
* CLI - `node src/index.js run server`

The relevant sections of the **operator configuration** for the **Server** are:

* [`operator.name`](https://json-schema.app/view/%23/%23%2Fproperties%2Foperator?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json) -- Define the reddit users who will be able to have full access to this server regardless of moderator status
* `api`

### [`api`](https://json-schema.app/view/%23/%23%2Fproperties%2Fapi?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

* `port` - The port the Server will listen on for incoming api requests. Cannot be the same as the Client (when running on the same host)
* `secret` - The **shared secret** that will be used to verify incoming api requests coming from an authenticated Client.
* `friendly` - An optional string to identify this **Server** on the client. It is recommended to provide this otherwise it will default to `host:port`

## Client

To run a ContextMod instance as **client only:**

* Config file -- define top-level `"mode":"client"`
* ENV -- `MODE=client`
* CLI - `node src/index.js run client`

### [`web`](https://json-schema.app/view/%23/%23%2Fproperties%2Fweb?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

In the **operator configuration** the top-level `web` property defines the configuration for the **Client** application.

* `web.credentials` -- Defines the reddit oauth credentials used to authenticate users for the web interface
  * Must contain a `redirectUri` property to work
  * Credentials are parsed from ENV/CLI credentials when not specified (IE will be same as default bot)
* `web.operators` -- Parsed from `operator.name` if not specified IE will use same users as defined for the bot operators
* `port` -- the port the web interface will be served from, defaults to `8085`
* `clients` -- An array of `BotConnection` objects that specify what **Server** instances the web interface should connect to. Each object should have:
  * `host` -- The URL specifying where the server api is listening ie `localhost:8085`
  * `secret` -- The **shared secret** used to sign api calls. **This should be the same as `api.secret` on the server being connected to.**
