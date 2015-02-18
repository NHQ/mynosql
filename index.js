'use strict'
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var pl        = require('pull-level')
var paramap   = require('pull-paramap')
var timestamp = require('monotonic-timestamp')
var defer     = require('pull-defer')

var cont      = require('cont')

var createFilter = require('./filter')
var createInit = require('./init')
var pathTo = require('./path')

function addTo(aryTo, aryFrom) {
  aryFrom.forEach(function (e) { aryTo.push(e) })
}

var isArray = Array.isArray

function find (ary, test) {
  for(var i = 0; i < ary.length; i++)
    if(test(ary[i], i, ary)) return ary[i]
}

module.exports = function (_db) {

  var db = sublevel(_db)
  var logDb = db.sublevel('log')

  // ************************************
  // Log / Scan
  //
  //index everything into logDb.

  db.pre(function (op, add) {
    add({
      prefix: logDb, type: 'put',
      key: timestamp(), value: op.key,
    })
  })

  //output EVERYTHING currently in the database.
  //in the same order as it was added.
  db.scan = function (opts) {
    return pull(
      pl.read(logDb),
      //filter by unique is a hack. would rather make sure
      //that things where not added twice...
      pull.unique('value'),
      paramap(function (data, cb) {
        db.get(data.value, function (err, value) {
          cb(null, {key: data.value, value: value, ts: data.key})
        })
      })
    )
  }

  // ************************************
  // Drain / Pause

  db.inflight = 0
  db.landed = 0

  var waiting = []
  db.pre(function () {
    db.inflight ++
  })

  db.post(function (op) {
    db.landed ++
    if(waiting.length && db.landed === db.landed)
      while(waiting.length) waiting.shift()()
  })

  db.drain = function (cb) {
    if(landed === inflight) cb()
    else waiting.shift(cb)
  }

  // ************************************
  // Index Creation
  //
  // for a set of paths into the database,
  // create indexes for those values.

  db.indexes = []

  db.createIndex = function (path, cb) {
    return db.createIndexes([path], cb)
  }

  db.createIndexes = function (paths, cb) {
    if(!cb) throw new Error('mynosql.createIndexes: must provide callback')

    var batch = [], maxTs = 0

    pull(
      db.scan(),
      pull.drain(function (data) {
        maxTs = Math.max(data.ts, maxTs)
        paths.forEach(function (path) {
          var value = pathTo(path, data.value)
          if(value !== undefined)
            batch.push({
              key: [path, value, data.key], value: '', type: 'put'
            })
        })
      },
      function (err) {
        paths.forEach(function (index) {
          batch.push({
            key: index, value: maxTs,
            prefix: db.sublevel('meta'), type: 'put'
          })
        })
        db.sublevel('idx').batch(batch, function (err) {
          if(err) return cb(err)
          paths.forEach(function (path) {
            db.indexes.push({path: path, since: maxTs})
          })
          cb()
        })
      })
    )
  }

  // ************************************
  // Querying!
  //

  //load the index table into memory...

  db.pre(function (data, add) {
    db.indexes.forEach(function (path) {
      add({
        key: [path, pathTo(path, data.value), data.key],
        value: '', type: 'put', prefix: db.sublevel('idx')
      })
    })
  })

  var init = createInit(function (cb) {
    pull(
      pl.read(db.sublevel('meta')),
      pull.drain(function (op) {
        db.indexes.push({
          path: op.key, since: op.since
        })
      }, cb)
    )
  })

  var strategies = [
    require('./query/filtered-index'),
    require('./query/scan')
  ]

  db.plan = cont(function (query, cb) {
    if(!isArray(query)) query = [query]
    init(function () {
      cb(null, strategies.map(function (strategy) {
        return strategy(db, query)
      }))
    })
  })

  db.query = function (query) {
    var stream = defer.source()
    db.plan(query, function (err, plans) {
      stream.resolve(plans.filter(Boolean).shift().exec())
    })
    return stream
  }

  return db
}
