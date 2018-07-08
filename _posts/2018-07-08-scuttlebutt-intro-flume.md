---
layout: post
title:  "An Introduction to Scuttlebutt Development: Flume & Plugins"
date:   2018-07-08 11:00:00 -0400
tags: scuttlebutt software
---
This will assume you have read and followed the previous post: [Your Test Playground](/2018/07/08/scuttlebutt-intro-test-playground.html). If you have not you should check that out before continuing.

## sbot Plugins

Now we'll take a look at one of these plugins for `sbot`. We'll use a fairly simple one, [ssb-about](https://github.com/ssbc/ssb-about), to demonstrate some things you can do in plugins. Plugins can add different types of functionality to sbot; what ssb-about adds, and what we will focus on here, is a database index, but plugins can also be used to handle functions such as replication logic and private messages.

You will see, if you look at the code for ssb-about that it consists of all of [52 lines of code](https://github.com/ssbc/ssb-about/blob/e7f9b0b243ec462fc2628c0eb7b9be29b06c10f1/index.js). Needless to say its not the most complex piece of code, but you will find that it is quite useful!

## Database Indexes

`sbot` uses a database called [Flume](https://github.com/flumedb/flumedb), which consists of an append-only log and modular views of that log. The log is where all the data is stored and messages are appended. Views are essentially indexes of the log and can be anything as long as they are generated strictly from the data, such that the same data will give you the same view if rebuild.

The type of view that ssb-about and many other ssb modules use is called `flumeview-reduce`, which uses a map-reduce function pair to create a view. The idea is simple enough, to create this view you define a map function and a reduce function. When paired with a log the view will be created by mapping over every message in the log and then reducing into a single object, which is returned as the view. If you've never encountered the map-reduce programming pattern I recommend you [read a bit about it](https://en.wikipedia.org/wiki/MapReduce).

Each individual message is not important here, what is important is the final reduced state, the view. After reducing all the existing messages in the log the view is stored so that it does not need to be recomputed each time a new message is added to the log. Instead the new message is just reduced into the stored view to create a new view, this makes it very efficient at handling incoming data.

## ssb-about

`ssb-about` is an `sbot` plugin which keeps track of `about` messages. `about` messages are the messages primarily used to name things. For example, when you startup Patchwork for the first time and it asks you to input a name for yourself. That is publishing an `about` message about yourself. It would look something like this:

{% highlight json %}
{
  "key": "%tceR4cb3J/aIOd1vwm96OAlj4y62LqbtLsVPiS1CfLs=.sha256",
  "value": {
    "previous": "%PYHOPseaFKTFfkSXbtMjuQC7fC5BvePflQamh1812K0=.sha256",
    "sequence": 1,
    "author": "@MKEfPpaGFMInD9P0ZIUykojfwaXmo6CtWOzB1EBC4qg=.ed25519",
    "timestamp": 1521080232427,
    "hash": "sha256",
    "content": {
      "type": "about",
      "about": "%scqes7231lx8Gak1DTrXjsFSLwnhVqXxBSGkkj5UCPs=.sha256",
      "name": "Eve"
    },
    "signature": "T44+YzUoCfATdl0XXNK4jw0btqkOeQUHopZR6nq+/0eBZlx8sGRpCXa6GrifEmXtJ7j1i5IK3Ymz1AvspnRdCw==.sig.ed25519"
  },
  "timestamp": 1521080232428
}
{% endhighlight %}

`ssb-about` keeps an index of these `about` messages so that clients can easily lookup things such as nicknames, descriptions, and display images, among other things. We'll go through `ssb-about` piece by piece so that you understand how these flume views work. The first thing in ssb-about are the dependencies:

{% highlight javascript %}
var FlumeReduce = require('flumeview-reduce')
var ref = require('ssb-ref')
{% endhighlight %}

`flumeview-reduce`, as mentioned earlier is the library that is used create the flume views here. `ssb-ref` is a helper library which provides the ability to check whether strings are valid ssb references or not. Next, some module information is provided:

{% highlight javascript %}
exports.name = 'about'
exports.version = require('./package.json').version
exports.manifest = {
  stream: 'source',
  get: 'async'
}
{% endhighlight %}

`name` is just the name you give the plugin, it should be the name of the library minus the `ssb-` prefix (I've had trouble with `sbot` not finding my plugins when this is not the case). `version` is just the version number of the package. `manifest` gives information on what methods are available from the about view and what types of functions they are. `source` is a live stream of messages, `async` is unsurprisingly an asynchronous function with a callback, and there is also a `sync` option which is for synchronous functions.

Following the module information, the flume view is declared:

{% highlight javascript %}
exports.init = function (ssb, config) {
  return ssb._flumeUse('about', FlumeReduce(1, reduce, map))
}
{% endhighlight %}

This function is taking in an `sbot` which, here, is `ssb` and some optional configuration which currently is not utilized. Your `sbot` already has an existing log with messages in it, so all that needs to be done is add a view to it, this is what `_flumeUse()` does. The first argument is the name of the view and how you would access the module through an `sbot` client. For example `sbot.about.stream()` would return the stream of messages flowing through this view. The second argument is the view itself, which here is a `FlumeReduce` view.

FlumeReduce itself takes several arguments, the first being the version of the view. The version can be anything, but a number is recommended. Every time the version changes the view will be rebuild from scratch to account for any changes that have been made. Its useful to know that the version number does not always need to increment, so when developing and testing a view you can flip between just two versions and succesfully rebuild the view each time.

The second, and last required, argument is a reduce function. The reduce function takes in a message and indexes it in the view. The third, and first optional, argument is the map function. The map function is called prior to the reduce function on a message and performs a transformation on the message before it is reduced.

The other two optional arguments, unused here, are the codec and an initial state. The codec can be specified and used in the event your log uses the filesystem and the initial state provides an initial reduce state in the event that no messages have been reduced yet.

The `_flumeUse` function returns an object with a `stream` function and a `get` function in it; this aligns with what was specified in the `manifest` above. The `stream` function gives a [pull-stream](https://github.com/pull-stream/pull-stream) whose first value is the current state of the view and following values new messages coming into the view. The `get` function simply gives the current state of the view.

Finally, we will look at how the view is actually built. Let's skip over the `reduce` function for now and jumpy straight to the `map` function:

{% highlight javascript %}
function map (msg) {
  if (msg.value.content && msg.value.content.type === 'about' && ref.isLink(msg.value.content.about)) {
    var author = msg.value.author
    var target = msg.value.content.about
    var values = {}

    for (var key in msg.value.content) {
      if (key !== 'about' && key !== 'type') {
        values[key] = {
          [author]: [msg.value.content[key], msg.value.timestamp]
        }
      }
    }

    return {
      [target]: values
    }
  }
}
{% endhighlight %}

The outer if statement is filtering out any messages that are not `about` messages, which is what this view is for. After that it pulls some helpful variables out of the message structure: namely the author reference and the reference to the target that is being described. Following this the values dictionary is initialized and populated based on the message. Any key values pairs in the message content other than `type` and `about` will be taken to be describing the target. The index keeps track and what is being described (`key`), the description (`content[key]`), who described it (`author`), and when they described it (`timestamp`).

The sample `about` message from above would be mapped to:

{% highlight json %}
{
  "@MKEfPpaGFMInD9P0ZIUykojfwaXmo6CtWOzB1EBC4qg=.ed25519": {
    "name": {
      "@MKEfPpaGFMInD9P0ZIUykojfwaXmo6CtWOzB1EBC4qg=.ed25519": [ "Eve", 1521080232427 ]
    }
  }
}
{% endhighlight %}

Here, the user `@MKEfPpaGFMInD9P0ZIUykojfwaXmo6CtWOzB1EBC4qg=.ed25519` is naming themselves `"Eve"` and this happened at 1521080232427.

Now digging into the `reduce` function:

{% highlight javascript %}
function reduce (result, item) {
  if (!result) result = {}
  if (item) {
    for (var target in item) {
      var valuesForId = result[target] = result[target] || {}
      for (var key in item[target]) {
        var valuesForKey = valuesForId[key] = valuesForId[key] || {}
        for (var author in item[target][key]) {
          var value = item[target][key][author]
          if (!valuesForKey[author] || value[1] > valuesForKey[author][1]) {
            valuesForKey[author] = value
          }
        }
      }
    }
  }
  return result
}
{% endhighlight %}

This function is a little dense, but if you go through it piece my piece it becomes clearer. `result` is the currently reduced state (if there is none it will be set to the `initialState` passed to `FlumeReduce`, which in this case is `undefined`) and `item` is a message from the log which has been mapped by the `map` function. Since no `initialState` is specified, there is a check to ensure that `result` is initialized, as well as a check to make sure `item` exists.

The rest of these nested `for` loops basically amount to merging `item` into `result` while making sure everything is initialized. The if statement at the inner `for` loop, is checking whether the incoming value is newer than the existing value based on the timestamps; the incoming value is only accepted if it is newer, otherwise the existing value remains.

And that's it, that's how the `ssb-about` plugin works to build the `about` message index!

## Hello World

Now, it's time to make your own little `sbot` plugin. We're going to make a simple little view of Hello World messages. If you have gone through the previous post you will already have one of these messages in your testnet log, if not, you can add one by simply running:

{% highlight bash %}
sbot publish --type post --text "Hello World!"
{% endhighlight %}

The view we're going to make will look something like this:

{% highlight javascript %}
{
  [author]: [{
    message: [message_id],
    timestamp: [timestamp]
  }]
}
{% endhighlight %}

So we'll start with making our new project:

{% highlight bash %}
mkdir ssb-helloworld
cd ssb-helloworld
npm init
npm install --save flumeview-reduce ssb-ref
{% endhighlight %}

Next we'll fill out the boilerplate of our plugin, similar to `ssb-about`:

{% highlight javascript %}
var FlumeReduce = require('flumeview-reduce')
var ref = require('ssb-ref')

exports.name = 'helloworld'
exports.version = require('./package.json').version
exports.manifest = {
  stream: 'source',
  get: 'async'
}

exports.init = function (ssb, config) {
  return ssb._flumeUse('helloworld', FlumeReduce(1, reduce, map))
}

function reduce (result, item) {}

function map (msg) {}
{% endhighlight %}

I think we'll try using the `initialState` parameter this time around, so we'll change it up as such:

{% highlight javascript %}

var initialState = {}

exports.init = function (ssb, config) {
  return ssb._flumeUse('helloworld', FlumeReduce(1, reduce, map, null, initialState))
}
{% endhighlight %}

Now taking a look at the map function. We only want to index `post` messages with the text `Hello World!`. From that, we want to keep track of all the message ids and who published those messages. From that we end up with the following `map` function:

{% highlight javascript %}
function map (msg) {
  if (msg.value.content &&
      msg.value.content.type === 'post' &&
      msg.value.content.text === 'Hello World!') {
    var author = msg.value.author

    return {
      [author]: [{
        message: msg.key,
        timestamp: msg.value.timestamp
      }]
    }
  }
}
{% endhighlight %}

This will provide us with a stream of author to message id pairs into our `reduce` function. In our reduce function, after making sure the `item` exists we want to loop through all the `author`s in the `item` in order to add the message ids to the index. If an `author` has no previous messages in the index, their index needs to be initialized; then the message ids from the `item` can be concatenated to the end. After the entire item has been processed the result is returned.

{% highlight javascript %}
function reduce (result, item) {
  if (item) {
    for (var author in item) {
      if (!result[author]) result[author] = []
      result[author] = result[author].concat(item[author])
    }
  }
  return result
}
{% endhighlight %}

To install this into our `sbot` folder we need to `npm link` it. First in the `ssb-helloworld` directory run:

{% highlight bash %}
npm link
{% endhighlight %}

Then navigating into your `sbot` directory (`ssb-test` if you are following along), run:

{% highlight bash %}
npm link ssb-helloworld
{% endhighlight %}

Now restart your `sbot` and check whether your view was created as intended. To check the current state of the view you can open up a `node` REPL with `ssb-client` to query the view.

{% highlight javascript %}
var ssbClient = require('ssb-client')

ssbClient(function (err, sbot) {
  sbot.helloworld.get((err, state) => {
    if (err) console.error(err)
    else console.log(state)
  })
  sbot.close()
})
{% endhighlight %}

If all went well you should see something similar to the outlined structure above:

{% highlight json %}
{
  "@MKEfPpaGFMInD9P0ZIUykojfwaXmo6CtWOzB1EBC4qg=.ed25519": [
    {
      "message": "%yaQL8/anqArSnybN8Isv5CgQz/Nkrski4CpKBM0wNbc=.sha256",
      "timestamp": 1524275394775
    }
  ]
}
{% endhighlight %}

Here, `%yaQL8/anqArSnybN8Isv5CgQz/Nkrski4CpKBM0wNbc=.sha256` is the id of the `"Hello World"` message published earlier.

## What's Next

You now have a very basic custom `sbot` plugin installed in your local `sbot`. Next, I will take a closer look at Patchbay and how you can build user interfaces for Scuttlebutt.
