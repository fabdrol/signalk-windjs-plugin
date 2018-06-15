
const BASE_URL = '/plugins/signalk-windjs-plugin/latest'

function initMap () {
  const EsriDarkGreyCanvas = L.tileLayer('http://{s}.sm.mapstack.stamen.com/(positron,$fff[difference],$fff[@23],$fff[hsl-saturation@20])/{z}/{x}/{y}.png', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
  })

  return new Promise((resolve) => {
    $.getJSON(BASE_URL, function (data) {
      const velocityLayer = L.velocityLayer({
        displayValues: true,
        displayOptions: {
          velocityType: 'Wind',
          displayPosition: 'bottomleft',
          displayEmptyString: 'No wind data'
        },
        data: data,
        maxVelocity: 10
      })

      const map = L.map('map', {
        layers: [
          EsriDarkGreyCanvas,
          velocityLayer
        ]
      })

      map.setView([52.37, 4.9], 7)
      resolve({
        map,
        layers: {
          EsriDarkGreyCanvas,
          velocityLayer
        }
      })
    })
  })
}

function reloadData (mapNS) {
  return new Promise((resolve) => {
    $.getJSON(BASE_URL, function (data) {
      mapNS.layers.velocityLayer.setData(data)
    })
  })
}

let INTERVAL = null

initMap().then(ns => {
  if (INTERVAL === null) {
    INTERVAL = setInterval(() => {
      reloadData(ns)
    }, 30000)
  }
})
