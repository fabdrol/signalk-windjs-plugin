/*
 * wind-js-plugin
 *
 * @author: Fabian Tollenaar <fabian@decipher.industries>
 * @license: MIT
 * @copyright: 2018, Fabian Tollenaar/Signal K
 *
 */

/* DEPENDENCIES */
const pkg = require('./package.json')
const debug = require('debug')(`${pkg.name}:${pkg.version}`)
const moment = require('moment')
const request = require('request')
const fs = require('fs')
const Q = require('q')

/* CONSTANTS */
const BASE_DIR = 'http://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl'
const INTERVAL = 900000
let CHECK_INTERVAL = null

module.exports = function windJSPlugin (app, options) {
  const plugin = {
    id: pkg.name,
    version: pkg.version,
    name: `WindJS GRIB2 server, version ${pkg.version}`,
    description: 'This plugin scrapes NOAA GRIB2 and makes them available in JSON format.',
    schema: {}
  }

  const handlers = {
    index (req, res) {
      res.send(plugin.name)
    },

    alive (req, res) {
      res.send(`${Date.now()} ${plugin.name}`)
    },

    latest (req, res) {
      /**
       * Find and return the latest available 6 hourly pre-parsed JSON data
       * @param targetMoment {Object} UTC moment
       */
      function sendLatest (targetMoment) {
        const stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6)
        const fileName = `${__dirname}/json-data/${stamp}.json`

        res.setHeader('Content-Type', 'application/json')
        res.sendFile(fileName, {}, function (err) {
          if (err) {
            console.log(stamp + ' doesnt exist yet, trying previous interval..')
            sendLatest(moment(targetMoment).subtract(6, 'hours'))
          }
        })
      }

      sendLatest(moment().utc())
    },

    nearest (req, res, next) {
      const time = req.query.timeIso
      const limit = req.query.searchLimit
      let searchForwards = false

      /**
       * Find and return the nearest available 6 hourly pre-parsed JSON data
       * If limit provided, searches backwards to limit, then forwards to limit before failing.
       *
       * @param targetMoment {Object} UTC moment
       */
      function sendNearestTo (targetMoment) {
        if (limit && Math.abs(moment.utc(time).diff(targetMoment, 'days')) >= limit) {
          if (!searchForwards) {
            searchForwards = true
            sendNearestTo(moment(targetMoment).add(limit, 'days'))
            return
          } else {
            return next(new Error('No data within searchLimit'))
          }
        }

        const stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6)
        const fileName = `${__dirname}/json-data/${stamp}.json`

        res.setHeader('Content-Type', 'application/json')
        res.sendFile(fileName, {}, function (err) {
          if (err) {
            var nextTarget = searchForwards ? moment(targetMoment).add(6, 'hours') : moment(targetMoment).subtract(6, 'hours')
            sendNearestTo(nextTarget)
          }
        })
      }

      if (time && moment(time).isValid()) {
        sendNearestTo(moment.utc(time))
      } else {
        return next(new Error('Invalid params, expecting: timeIso=ISO_TIME_STRING'))
      }
    }
  }

  plugin.registerWithRouter = function registerWindJSPluginRoutes (router) {
    router.get('/wind', handlers.index)
    router.get('/wind/alive', handlers.alive)
    router.get('/wind/latest', handlers.latest)
    router.get('/wind/nearest', handlers.nearest)
  }

  plugin.start = function startWindJSPlugin () {
    if (CHECK_INTERVAL === null) {
      CHECK_INTERVAL = setInterval(() => run(moment.utc()), INTERVAL)
    }

    run(moment.utc())
  }

  plugin.stop = function stopWindJSPlugin () {
    if (CHECK_INTERVAL !== null) {
      clearInterval(CHECK_INTERVAL)
    }
  }

  return plugin
}

/**
 *
 * @param targetMoment {Object} moment to check for new data
 */
function run (targetMoment) {
  getGribData(targetMoment).then(function (response) {
    if (response.stamp) {
      convertGribToJson(response.stamp, response.targetMoment)
    }
  })
}

/**
 *
 * Finds and returns the latest 6 hourly GRIB2 data from NOAAA
 *
 * @returns {*|promise}
 */
function getGribData (targetMoment) {
  const deferred = Q.defer()

  function runQuery (targetMoment) {
    // only go 2 weeks deep
    if (moment.utc().diff(targetMoment, 'days') > 30) {
      debug('hit limit, harvest complete or there is a big gap in data..')
      return
    }

    var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6)
    request.get({
      url: BASE_DIR,
      qs: {
        file: 'gfs.t' + roundHours(moment(targetMoment).hour(), 6) + 'z.pgrb2.1p00.f000',
        lev_10_m_above_ground: 'on',
        lev_surface: 'on',
        var_TMP: 'on',
        var_UGRD: 'on',
        var_VGRD: 'on',
        leftlon: 0,
        rightlon: 360,
        toplat: 90,
        bottomlat: -90,
        dir: '/gfs.' + stamp
      }
    })
      .on('error', function () {
        // debug(err);
        runQuery(moment(targetMoment).subtract(6, 'hours'))
      })
      .on('response', function (response) {
        debug('response ' + response.statusCode + ' | ' + stamp)

        if (response.statusCode !== 200) {
          runQuery(moment(targetMoment).subtract(6, 'hours'))
        } else {
          // don't rewrite stamps
          if (!checkPath('json-data/' + stamp + '.json', false)) {
            debug('piping ' + stamp)

            // mk sure we've got somewhere to put output
            checkPath('grib-data', true)

            // pipe the file, resolve the valid time stamp
            var file = fs.createWriteStream('grib-data/' + stamp + '.f000')
            response.pipe(file)
            file.on('finish', function () {
              file.close()
              deferred.resolve({stamp: stamp, targetMoment: targetMoment})
            })
          } else {
            debug('already have ' + stamp + ', not looking further')
            deferred.resolve({stamp: false, targetMoment: false})
          }
        }
      })
  }

  runQuery(targetMoment)
  return deferred.promise
}

function convertGribToJson (stamp, targetMoment) {
  // mk sure we've got somewhere to put output
  checkPath('json-data', true)
  const exec = require('child_process').exec

  exec('converter/bin/grib2json --data --output json-data/' + stamp + '.json --names --compact grib-data/' + stamp + '.f000',
    { maxBuffer: 500 * 1024 },
    function (error, stdout, stderr) {
      if (error) {
        debug('exec error: ' + error)
      } else {
        // don't keep raw grib data
        exec('rm grib-data/*')
        // if we don't have older stamp, try and harvest one
        const prevMoment = moment(targetMoment).subtract(6, 'hours')
        const prevStamp = prevMoment.format('YYYYMMDD') + roundHours(prevMoment.hour(), 6)

        if (!checkPath('json-data/' + prevStamp + '.json', false)) {
          debug('attempting to harvest older data ' + stamp)
          run(prevMoment)
        } else {
          debug('got older, no need to harvest further')
        }
      }
    })
}

/**
 *
 * Round hours to expected interval, e.g. we're currently using 6 hourly interval
 * i.e. 00 || 06 || 12 || 18
 *
 * @param hours
 * @param interval
 * @returns {String}
 */
function roundHours (hours, interval) {
  if (interval > 0) {
    var result = (Math.floor(hours / interval) * interval)
    return result < 10 ? '0' + result.toString() : result
  }
}

/**
 * Sync check if path or file exists
 *
 * @param path {string}
 * @param mkdir {boolean} create dir if doesn't exist
 * @returns {boolean}
 */
function checkPath (path, mkdir) {
  try {
    fs.statSync(path)
    return true
  } catch (e) {
    if (mkdir) {
      fs.mkdirSync(path)
    }
    return false
  }
}
