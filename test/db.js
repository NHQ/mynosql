
var level = require('level-test')()
var tape = require('tape')

var db = require('../')(level('test-mynosql', {encoding: 'json'}))

var pl   = require('pull-level')
var pull = require('pull-stream')
var pfs  = require('pull-fs')
var glob = require('pull-glob')

var createHash = require('crypto').createHash

function hash(o) {
  return createHash('sha256')
    .update(JSON.stringify(o))
    .digest().slice(0, 20).toString('base64')
}

function compare (a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

//load all the dependencies into database.

tape('query dependency database', function (t) {

  pull(
    glob('**/package.json'),
    pfs.readFile(JSON.parse),
    pull.map(function (pkg) {
      return {key: hash(pkg), value: pkg, type: 'put'}
    }),
    pl.write(db, function (err) {
      if(err) throw err
      console.log('written')

      t.end()

    })
  )

})

var query = [{path: ['version'], lt: '1.0.0'}]

tape('full scan', function (t) {

  pull(
    require('../query/scan')(db, query).exec(),
    pull.collect(function (err, fullScanAry) {

      fullScanAry.forEach(function (pkg) {
        t.ok(pkg.value.version < '1.0.0')
      })


      db.createIndex(['version'], function (err) {
        pull(
          require('../query/filtered-index')(db, query).exec(),
          pull.collect(function (err, ary) {
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

            t.deepEqual(ary, fullScanAry.map(function (e) {
              delete e.ts; return e
            }))

            t.end()
          })
        )

      })

    })
  )

})
