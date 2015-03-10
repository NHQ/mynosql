
var level = require('level-test')()
var tape = require('tape')
var util = require('../util')

var db = require('../')(level('test-mynosql', {encoding: 'json'}))
var db2 = require('../')(level('test-mynosql2', {encoding: 'json'}))

var pl   = require('pull-level')
var pull = require('pull-stream')

var pull = require('pull-stream')
var pl   = require('pull-level')


var LO = null
var HI = undefined

function compare (a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

var all = function (stream, cb) {
  if('function' === typeof cb) return go(cb)

  function go (cb) {
    pull(stream, pull.collect(cb))
  }

  return go
}

function _pluck (name) {
  return function (it) { return it[name] }
}


function test (query, strategies, asserts) {

  var qstr =  JSON.stringify(query)

  var ary
  tape('setup: ' + qstr, function (t) {

    db.wipeIndexes(function (err) {
      pull(
        db.query(query), //will scan, and build indexes.
        pull.collect(function (err, _ary) {
          ary = _ary
          t.ok(ary.length)
          t.end()
        })
      )
    })
  })

  strategies.forEach(function (strategy) {

    tape(strategy + '('+qstr+')', function (t) {
      db.plan(query, {}) (function (err, plans) {
        var plan = util.find(plans, function (e) {
          return e.name === strategy
        })
        t.ok(plan, 'found plan for:' + strategy)
        pull(plan.exec(), pull.collect(function (err, _ary) {
          t.deepEqual(
            _ary.map(_pluck('key')).sort(),
            ary.map(_pluck('key')).sort()
          )
          if(asserts) asserts(t, _ary, ary)
          t.end()
        }))
      })
    })
  })
}

//load all the dependencies into database.

tape('query dependency database', function (t) {

  require('../example').init(db, null, function (err) {
    if(err) throw err
    t.end()
  })

})

var query = [{path: ['version'], lt: '1.0.0'}]


test(
  [{path: ['version'], lt: '1.0.0'}], 
  ['filtered']
)

test([
    {path: ['name'], eq: 'ltgt'},
    {path: ['version'], gte: '2.0.0', lt: '3.0.0'}
  ],
  ['filtered', 'intersection']
)

test([
    {path: ['name'], eq: 'ltgt'},
    {path: ['version'], gte: '2.0.0', lt: '3.0.0'}
  ],
  ['filtered']
)

test([
    {path: ['keywords', true], eq: 'database'}
  ],
  ['filtered']
)

/*
tape('full scan', function (t) {

  //first query will be full scan. kinda slow
  var scantime = Date.now()
  all(db.query(query), function (err, fullScanAry) {
      scantime = Date.now() - scantime
      fullScanAry.forEach(function (pkg) {
        t.ok(pkg.value.version < '1.0.0')
      })

      //second query should use in memory indexes. REALLY FAST!
      var indextime = Date.now()
      all(db.query(query), function (err, ary) {
        indextime = Date.now() - indextime

        t.ok(indextime < scantime)

        console.log('query times', {scan: scantime, index: indextime})
        ary.forEach(function (pkg) {
          t.ok(pkg.value.version < '1.0.0')
        })
        fullScanAry.sort(function (a, b) {
          return (
            compare(a.value.version, b.value.version) || 
            compare(a.key, b.key)
          )
        })

        t.equal(ary.length, fullScanAry.length)

        function min (e) {
          return [e.key, e.value.name, e.value.version]
        }

        t.deepEqual(ary.map(min), fullScanAry.map(min))

        t.deepEqual(ary.slice(0, 3), fullScanAry.map(function (e) {
          delete e.ts; return e
        }).slice(0, 3))

        t.end()
      })
  })

})

//currently, the name index will not be automatically created
//on this query. Need to implement intersection strategy.

tape('multiple indexes', function (t) {

  t.deepEqual(db.indexes.map(function (e) { return e.path }), [
    [['version']]
  ])

    all(db.query([
      {path: ['name'], eq: 'ltgt'},
      {path: ['version'], gte: '2.0.0', lt: '3.0.0'}
    ])) (function (err, ary) {
      if(err) throw err
      t.ok(ary.length >= 1)
      ary.forEach(function (pkg) {
        t.equal(pkg.value.name, 'ltgt')
        t.ok(pkg.value.version >= '2.0.0')
        t.ok(pkg.value.version < '3.0.0')
      })

      t.deepEqual(db.indexes.map(function (e) { return e.path }), [
        [['version']], [['name']]
      ])
      
      t.end()
    })
})


tape('glob query for keyword.*', function (t) {
  var start = Date.now()
  all(db.query([
    {path: ['keywords', true], eq: 'database'}
  ])) (function (err, ary) {
    var p = ary.filter(function (pkg) {
      return pkg.value.name === 'level'
    }).shift()
    t.equal(p.value.name, 'level')

    var scantime = Date.now() - start
    
    start = Date.now()
    all(db.query([
      {path: ['keywords', true], eq: 'database'}
    ])) (function (err, ary) {
      //check the index time is smaller than full scan time
      //although both will be small since the database is tiny.
      var indextime = Date.now() - start
      t.ok(indextime < scantime)
      console.log('query time', {scan:scantime, index: indextime})
      t.end()
    })
  })
})

//*/
