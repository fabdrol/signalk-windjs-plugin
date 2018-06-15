# signalk-windjs-plugin

> Node.js Signal K server plugin that provides wind information, based on the work done by @danwild and Cameron Beccario (big thanks!). This plugin scrapes GRIB2 wind forecast information from NOAA, converts it to JSON and makes it available on an SK server.

## Endpoints
This plugins provides a couple of endpoints:

`/plugins/signalk-windjs-plugin/latest` - returns the latest GRIB2 file available
`/plugins/signalk-windjs-plugin/nearest?timeIso=2018-06-15T17:55:24.419Z` - returns the nearest GRIB2 file to the provided timestamp


## UI
In addition to the JSON endpoints, the plugin provides a (basic) UI based on Leaflet and [danwild/leaflet-velocity](https://github.com/danwild/leaflet-velocity) at `/plugins/signalk-windjs-plugin/ui`.

![UI](https://raw.githubusercontent.com/fabdrol/signalk-windjs-plugin/master/screenshot.png)
