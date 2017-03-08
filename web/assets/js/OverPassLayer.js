// query overpass server - based on https://github.com/kartenkarsten/leaflet-layer-overpass

function show_overpass_layer(query) {
	if (siteDebug) console.debug(query);
	if (!query || query === '();') {
		console.log('There is nothing selected to filter by.');
		return;
	}
	var opl = new L.OverPassLayer({
		debug: siteDebug,
		minzoom: minOpZoom,
		query: query + 'out center;&contact=' + email, // contact info only for use with .fr endpoints
		// endpoint: 'https://api.openstreetmap.fr/oapi/interpreter/',
		endpoint: 'https://overpass.osm.vi-di.fr/api/',
		callback: callback,
		minZoomIndicatorOptions: {
			position: 'topright',
			minZoomMessage: 'Zoom in to load data'
		}
	});
	iconLayer.addLayer(opl);
}

function poiCounter() {
	var str = $('.leaflet-marker-icon').length;
	if (str === 1) str += ' POI';
	else str += ' POIs';
	return str + ' found';
}

L.Control.MinZoomIndicator = L.Control.extend({
	// map: layerId -> zoomlevel
	_layers: {},
	// TODO check if nessesary
	initialize: function (options) {
		L.Util.setOptions(this, options);
		this._layers = new Object();
	},
	// adds a layer with minzoom information to this._layers
	_addLayer: function(layer) {
		var minzoom = 15;
		if (layer.options.minzoom) minzoom = layer.options.minzoom;
		this._layers[layer._leaflet_id] = minzoom;
		this._updateBox(null);
	},
	// removes a layer from this._layers
	_removeLayer: function(layer) {
		this._layers[layer._leaflet_id] = null;
		this._updateBox(null);
	},
	_getMinZoomLevel: function() {
		var minZoomlevel=-1;
		for(var key in this._layers) {
			if ((this._layers[key] != null)&&(this._layers[key] > minZoomlevel)) minZoomlevel = this._layers[key];
		}
		return minZoomlevel;
	},
	onAdd: function (map) {
		this._map = map;
		map.zoomIndicator = this;
		var className = this.className;
		var container = this._container = L.DomUtil.create('div', className);
		map.on('moveend', this._updateBox, this);
		this._updateBox(null);
		return container;
	},
	onRemove: function(map) {
		L.Control.prototype.onRemove.call(this, map);
		map.off({
			'moveend': this._updateBox
		}, this);
		this._map = null;
	},
	_updateBox: function (event) {
		if (event != null) L.DomEvent.preventDefault(event);
		var minzoomlevel = this._getMinZoomLevel();
		if (minzoomlevel == -1) $(this._container).html(this.options.minZoomMessageNoLayer);
		else if (this._map.getZoom() < minzoomlevel) $(this._container).html(this.options.minZoomMessage.replace(/CURRENTZOOM/, this._map.getZoom()).replace(/MINZOOMLEVEL/, minzoomlevel));
		else if ($('input.poi-checkbox:checked').length > 0) $(this._container).html(poiCounter());
		if (this._map.getZoom() >= minzoomlevel && $('input.poi-checkbox:checked').length === 0) $(this._container).css('display', 'none');
		else $(this._container).css('display', 'block');
	},
	className : 'theme leaflet-control-minZoomIndicator'
});

L.LatLngBounds.prototype.toOverpassBBoxString = function (){
	var a = this._southWest,
	b = this._northEast;
	return [a.lat, a.lng, b.lat, b.lng].join(',');
};

L.OverPassLayer = L.FeatureGroup.extend({
	options: {
		beforeRequest: function() {	if (this.options.debug) console.debug('about to query the OverPassAPI'); },
		afterRequest: function() { if (this.options.debug) console.debug('all queries have finished!');	}
	},
	initialize: function (options) {
		L.Util.setOptions(this, options);
		this._layers = {};
		// save position of the layer or any options from the constructor
		this._ids = {};
		this._requested = {};
	},
	// splits the current view in uniform bboxes to allow caching
	long2tile: function (lon,zoom) { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); },
	lat2tile: function (lat,zoom) { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); },
	tile2long: function (x,z) { return (x/Math.pow(2,z)*360-180); },
	tile2lat: function (y,z) {
		var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
		return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
	},
	_view2BBoxes: function(l,b,r,t) {
		var requestZoomLevel= 14;
		//get left tile index
		var lidx = this.long2tile(l,requestZoomLevel);
		var ridx = this.long2tile(r,requestZoomLevel);
		var tidx = this.lat2tile(t,requestZoomLevel);
		var bidx = this.lat2tile(b,requestZoomLevel);
		//var result;
		var result = new Array();
		for (var x=lidx; x<=ridx; x++) {
			for (var y=tidx; y<=bidx; y++) {
				var left = Math.round(this.tile2long(x,requestZoomLevel)*1000000)/1000000;
				var right = Math.round(this.tile2long(x+1,requestZoomLevel)*1000000)/1000000;
				var top = Math.round(this.tile2lat(y,requestZoomLevel)*1000000)/1000000;
				var bottom = Math.round(this.tile2lat(y+1,requestZoomLevel)*1000000)/1000000;
				result.push( new L.LatLngBounds(new L.LatLng(bottom, left),new L.LatLng(top, right)));
			}
		}
		return result;
	},
	addBBox: function (l,b,r,t) {
		var polygon = L.polygon([
			[t, l],
			[b, l],
			[b, r],
			[t, r]
		]).addTo(this._map);
	},
	onMoveEnd: function () {
		if (this.options.debug) console.debug('load Pois');
		if (this._map.getZoom() >= this.options.minzoom) {
			var bboxList = this._view2BBoxes(
			this._map.getBounds()._southWest.lng,
			this._map.getBounds()._southWest.lat,
			this._map.getBounds()._northEast.lng,
			this._map.getBounds()._northEast.lat);
			// controls the after/before (Request) callbacks
			var finishedCount = 0;
			var queryCount = bboxList.length;
			var beforeRequest = true;
			for (var i = 0; i < bboxList.length; i++) {
				var bbox = bboxList[i];
				var x = bbox._southWest.lng;
				var y = bbox._northEast.lat;
				if ((x in this._requested) && (y in this._requested[x]) && (this._requested[x][y] == true)) {
					queryCount--;
					continue;
				}
				if (!(x in this._requested)) {
					this._requested[x] = {};
				}
				this._requested[x][y] = true;
				var queryWithMapCoordinates = this.options.query.replace(/(screenBbox)/g, bbox.toOverpassBBoxString());
				var url = this.options.endpoint + 'interpreter?data=[out:json];' + queryWithMapCoordinates;
				// to show / hide the spinner
				$('#spinner').show();
				spinner++;
				if (beforeRequest) {
					this.options.beforeRequest.call(this);
					beforeRequest = false;
				}
				var self = this;
				var request = new XMLHttpRequest();
				request.open('GET', url, true);
				request.onload = function() {
					var indicatorMsg;
					if (this.status >= 200 && this.status < 400) {
						var reference = {instance: self};
						self.options.callback.call(reference, JSON.parse(this.response));
						if (self.options.debug) console.debug('queryCount: ' + queryCount + ' - finishedCount: ' + finishedCount);
						if (++finishedCount == queryCount) self.options.afterRequest.call(self);
						// show number of pois found
						if ($('input.poi-checkbox:checked').length > 0) indicatorMsg = poiCounter();
					}
					else if (this.status >= 400 && this.status <= 504) {
						indicatorMsg = '<i class="fa fa-exclamation-triangle fa-fw"></i> ERROR ' + this.status + ': ';
						if (this.status === 400) indicatorMsg += 'Bad Request.<br>Check the URL is correct or contact<br>' + email;
						else if (this.status === 429) indicatorMsg += 'Too Many Requests.<br>Please try a smaller area';
						else if (this.status === 504) indicatorMsg += 'Gateway Timeout.<br>Please try again later';
						else indicatorMsg += 'UNKNOWN ERROR<br>We have no idea what just happened, but something went wrong';
						self.options.callback.call(reference, {elements: []});
					}
					if (indicatorMsg) {
						$('.leaflet-control-minZoomIndicator').html(indicatorMsg);
						$('.leaflet-control-minZoomIndicator').css('display', 'block');
					}
				};
				request.send();
			}
		}
	},
	onAdd: function (map) {
		this._map = map;
		if (map.zoomIndicator) {
			this._zoomControl = map.zoomIndicator;
			this._zoomControl._addLayer(this);
		}
		else {
			this._zoomControl = new L.Control.MinZoomIndicator(this.options.minZoomIndicatorOptions);
			map.addControl(this._zoomControl);
			this._zoomControl._addLayer(this);
		}
		this.onMoveEnd();
		if (this.options.query.indexOf('(screenBbox)') != -1) map.on('moveend', this.onMoveEnd, this);
		if (this.options.debug) console.debug('add layer');
	},
	onRemove: function (map) {
		if (this.options.debug) console.debug('remove layer');
		L.LayerGroup.prototype.onRemove.call(this, map);
		this._ids = {};
		this._requested = {};
		this._zoomControl._removeLayer(this);
		map.off({ 'moveend': this.onMoveEnd }, this);
		this._map = null;
	},
	getData: function () {
		if (this.options.debug) console.debug(this._data);
		return this._data;
	}
});
