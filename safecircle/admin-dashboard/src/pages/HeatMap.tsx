import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { MapContainer, TileLayer, Polygon, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface ThreatZone {
  id: string;
  center_lat: number;
  center_lng: number;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  incident_count: number;
  coordinates_geojson: {
    type: string;
    coordinates: number[][][]; // GeoJSON format: [[[lng, lat], ...]]
  };
}

// Map Click Interceptor to place manual threat zones
function MapEventsHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function HeatMap() {
  const [zones, setZones] = useState<ThreatZone[]>([]);
  const [filteredZones, setFilteredZones] = useState<ThreatZone[]>([]);
  
  // Filter settings
  const [riskFilter, setRiskFilter] = useState<string>('all');

  // Manual Zone Form
  const [clickCoords, setClickCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [manualRisk, setManualRisk] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [manualIncidents, setManualIncidents] = useState<number>(5);
  const [addingZone, setAddingZone] = useState(false);

  useEffect(() => {
    fetchThreatZones();
  }, []);

  useEffect(() => {
    filterZones();
  }, [zones, riskFilter]);

  const fetchThreatZones = async () => {
    try {
      const { data, error } = await supabase
        .from('threat_zones')
        .select('*');

      if (error) throw error;
      setZones(data || []);
    } catch (err) {
      console.error('Error fetching threat zones:', err);
    }
  };

  const filterZones = () => {
    let result = [...zones];
    if (riskFilter !== 'all') {
      result = result.filter((z) => z.risk_level === riskFilter);
    }
    setFilteredZones(result);
  };

  const handleMapClick = (lat: number, lng: number) => {
    setClickCoords({ lat, lng });
  };

  const handleAddManualZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clickCoords) return;

    setAddingZone(true);
    try {
      // 1. Generate a small 100m square polygon around the coordinates
      const offset = 0.0009; // approx 100 meters in degrees
      const lat = clickCoords.lat;
      const lng = clickCoords.lng;

      const polygonGeoJSON = {
        type: 'Polygon',
        coordinates: [[
          [lng - offset, lat - offset],
          [lng + offset, lat - offset],
          [lng + offset, lat + offset],
          [lng - offset, lat + offset],
          [lng - offset, lat - offset]
        ]]
      };

      // 2. Perform DB Insert
      const { error } = await supabase
        .from('threat_zones')
        .insert({
          center_lat: lat,
          center_lng: lng,
          risk_level: manualRisk,
          incident_count: manualIncidents,
          coordinates_geojson: polygonGeoJSON
        });

      if (error) throw error;

      // Reset form & reload map
      setClickCoords(null);
      fetchThreatZones();
    } catch (err) {
      console.error('Error inserting manual zone:', err);
    } finally {
      setAddingZone(false);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical': return '#EF4444'; // Red
      case 'high': return '#F59E0B';    // Orange
      case 'medium': return '#8B5CF6';  // Purple
      default: return '#10B981';        // Green
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6 overflow-hidden">
      {/* Sidebar Controls */}
      <div className="w-80 flex flex-col bg-darkCard border border-darkBorder rounded-xl p-6 overflow-y-auto">
        <div className="mb-6">
          <h1 className="text-xl font-black text-white">Threat Heatmap</h1>
          <p className="text-xs text-slate-400 mt-1">DBSCAN clustered threat coordinates visualizer</p>
        </div>

        {/* Legend */}
        <div className="bg-darkBg/60 border border-darkBorder p-4 rounded-lg mb-6 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Zone Risk Legends</h3>
          <div className="flex items-center gap-2.5 text-xs text-slate-300">
            <div className="h-3 w-3 rounded bg-red-500" />
            <span>Critical Risk Area</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-300">
            <div className="h-3 w-3 rounded bg-amber-500" />
            <span>High Risk Area</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-300">
            <div className="h-3 w-3 rounded bg-violet-500" />
            <span>Medium Risk Area</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-300">
            <div className="h-3 w-3 rounded bg-emerald-500" />
            <span>Low Risk Area</span>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Filter Risk Level</label>
            <select
              className="w-full rounded-lg border border-darkBorder bg-darkBg px-3 py-2 text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
            >
              <option value="all">All Risk Levels</option>
              <option value="critical">🔴 Critical</option>
              <option value="high">🟡 High</option>
              <option value="medium">🟣 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>
        </div>

        {/* Add Manual Zone Form Overlay */}
        {clickCoords ? (
          <form onSubmit={handleAddManualZone} className="bg-red-950/10 border border-red-800/20 p-4 rounded-lg space-y-4">
            <h4 className="text-xs font-black uppercase text-red-500 tracking-wider">Add Manual Threat Zone</h4>
            <p className="text-[10px] text-slate-400">Selected coordinate: {clickCoords.lat.toFixed(4)}, {clickCoords.lng.toFixed(4)}</p>
            
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Risk Level</label>
              <select
                className="w-full rounded-lg border border-darkBorder bg-darkBg px-2 py-1 text-slate-200 text-xs focus:outline-none"
                value={manualRisk}
                onChange={(e: any) => setManualRisk(e.target.value)}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Simulated Incidents</label>
              <input
                type="number"
                className="w-full rounded-lg border border-darkBorder bg-darkBg px-2 py-1 text-slate-200 text-xs focus:outline-none"
                value={manualIncidents}
                onChange={(e) => setManualIncidents(parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setClickCoords(null)}
                className="flex-1 rounded-lg bg-darkBorder py-1.5 font-bold text-slate-300 text-xs hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingZone}
                className="flex-1 rounded-lg bg-red-600 py-1.5 font-bold text-white text-xs hover:bg-red-500 disabled:opacity-50"
              >
                {addingZone ? 'Adding...' : 'Create'}
              </button>
            </div>
          </form>
        ) : (
          <div className="text-xs text-slate-500 italic border border-dashed border-darkBorder p-4 rounded-lg text-center">
            💡 Click anywhere on the map to define and place a manual threat zone.
          </div>
        )}
      </div>

      {/* Leaflet Map Viewer */}
      <div className="flex-1 border border-darkBorder rounded-xl overflow-hidden bg-darkCard">
        <MapContainer
          center={[12.9716, 77.5946]} // Default centering (Bangalore coordinates)
          zoom={13}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />

          <MapEventsHandler onMapClick={handleMapClick} />

          {/* Render threat zone polygons */}
          {filteredZones.map((zone) => {
            const geojsonCoords = zone.coordinates_geojson?.coordinates;
            if (!geojsonCoords || geojsonCoords.length === 0) return null;

            // Convert GeoJSON coords [[lng, lat]] to Leaflet [[lat, lng]]
            const leafletCoords = geojsonCoords[0].map((c) => [c[1], c[0]]);

            return (
              <Polygon
                key={zone.id}
                positions={leafletCoords as any}
                pathOptions={{
                  color: getRiskColor(zone.risk_level),
                  fillColor: getRiskColor(zone.risk_level),
                  fillOpacity: 0.35,
                  weight: 2
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1 text-slate-200">
                    <div className="font-bold uppercase tracking-wider text-red-500">
                      🛡️ {zone.risk_level.toUpperCase()} THREAT ZONE
                    </div>
                    <div><span className="text-slate-400">Total Incidents:</span> {zone.incident_count}</div>
                    <div><span className="text-slate-400">Center:</span> {zone.center_lat.toFixed(5)}, {zone.center_lng.toFixed(5)}</div>
                  </div>
                </Popup>
              </Polygon>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
