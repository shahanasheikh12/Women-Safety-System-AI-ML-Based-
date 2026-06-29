import { useState, useEffect, Fragment } from 'react';
import { supabase } from '../supabase';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';

interface SOSEvent {
  id: string;
  user_id: string;
  status: 'active' | 'resolved' | 'escalated';
  trigger_method: 'button' | 'voice' | 'shake' | 'power_button' | 'accelerometer';
  started_at: string;
  resolved_at: string | null;
  resolution_type: 'safe' | 'false_alarm' | 'escalated' | null;
  location_lat: number;
  location_lng: number;
  user?: {
    name: string;
    phone: string;
  };
  notified_count?: number;
  duration_seconds?: number;
}

export default function SOSEvents() {
  const [events, setEvents] = useState<SOSEvent[]>([]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  
  // Filtering and pagination
  const [statusFilter, setStatusFilter] = useState('all');
  const [triggerFilter, setTriggerFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Detail panel loading states
  const [volunteersResponded, setVolunteersResponded] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, [statusFilter, triggerFilter, searchQuery]);

  const fetchEvents = async () => {
    try {
      // Query events and join victim (users table)
      let query = supabase
        .from('sos_events')
        .select('*, user:users(name, phone)')
        .order('started_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (triggerFilter !== 'all') {
        query = query.eq('trigger_method', triggerFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      let filtered = (data as any[]) || [];
      
      // Client-side text search (on victim name or event ID)
      if (searchQuery.trim()) {
        const lower = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.id.toLowerCase().includes(lower) ||
            (e.user?.name && e.user.name.toLowerCase().includes(lower))
        );
      }

      // Add notified counts mock/query mappings
      const enriched = await Promise.all(
        filtered.map(async (event) => {
          // Fetch notified counts
          const { count } = await supabase
            .from('volunteer_responses')
            .select('id', { count: 'exact', head: true })
            .eq('sos_event_id', event.id);

          // Calculate duration
          let duration = 0;
          if (event.resolved_at) {
            duration = Math.round(
              (new Date(event.resolved_at).getTime() - new Date(event.started_at).getTime()) / 1000
            );
          } else {
            duration = Math.round((Date.now() - new Date(event.started_at).getTime()) / 1000);
          }

          return {
            ...event,
            notified_count: count || 0,
            duration_seconds: duration,
          };
        })
      );

      setEvents(enriched);
      setCurrentPage(1);
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  };

  const toggleRow = async (eventId: string) => {
    if (expandedRowId === eventId) {
      setExpandedRowId(null);
      setVolunteersResponded([]);
      return;
    }

    setExpandedRowId(eventId);
    setLoadingDetails(true);

    try {
      // Fetch volunteers who responded to this event
      const { data, error } = await supabase
        .from('volunteer_responses')
        .select('*, volunteer:users(name, phone, trust_score)')
        .eq('sos_event_id', eventId);

      if (error) throw error;
      setVolunteersResponded(data || []);
    } catch (err) {
      console.error('Error loading responder details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const exportCSV = () => {
    if (events.length === 0) return;
    
    const headers = ['Event ID', 'Victim Name', 'Victim Phone', 'Status', 'Trigger Method', 'Duration (seconds)', 'Date/Time', 'Resolution'];
    const rows = events.map((e) => [
      e.id,
      e.user?.name || 'Unknown',
      e.user?.phone || 'Unknown',
      e.status,
      e.trigger_method,
      e.duration_seconds,
      e.started_at,
      e.resolution_type || 'unresolved',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SafeCircle_SOS_Events_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pagination bounds
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = events.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(events.length / itemsPerPage);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-red-950/40 text-red-500 border-red-800/40';
      case 'resolved':
        return 'bg-emerald-950/40 text-emerald-500 border-emerald-800/40';
      default:
        return 'bg-violet-950/40 text-violet-400 border-violet-800/40'; // escalated
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-white">SOS Incident Log</h1>
          <p className="text-slate-400 mt-1">Audit emergency alerts, track responders, and view evidence feeds</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 font-bold text-white text-sm transition-colors shadow-md"
        >
          <Download size={16} />
          Export to CSV
        </button>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-darkCard border border-darkBorder p-4 rounded-xl">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Search Victim</label>
          <input
            type="text"
            className="w-full rounded-lg border border-darkBorder bg-darkBg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="Search by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Alert Status</label>
          <select
            className="w-full rounded-lg border border-darkBorder bg-darkBg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Incidents</option>
            <option value="active">🔴 Active Now</option>
            <option value="resolved">🟢 Resolved</option>
            <option value="escalated">🟣 Escalated</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Trigger Mode</label>
          <select
            className="w-full rounded-lg border border-darkBorder bg-darkBg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
            value={triggerFilter}
            onChange={(e) => setTriggerFilter(e.target.value)}
          >
            <option value="all">All Methods</option>
            <option value="button">Button Click</option>
            <option value="voice">Voice SOS</option>
            <option value="shake">Device Shake</option>
            <option value="power_button">Power Key Press</option>
            <option value="accelerometer">Fall Detection</option>
          </select>
        </div>
      </div>

      {/* Events Table */}
      <div className="overflow-hidden border border-darkBorder bg-darkCard rounded-xl shadow-md">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-darkBorder bg-slate-900/50 text-slate-300 font-bold uppercase text-xs">
              <th className="p-4">Victim Name</th>
              <th className="p-4">Status</th>
              <th className="p-4">Trigger</th>
              <th className="p-4">Duration</th>
              <th className="p-4 text-center">Responders</th>
              <th className="p-4">Time/Date</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-darkBorder text-slate-300">
            {currentItems.map((e) => {
              const isExpanded = expandedRowId === e.id;
              return (
                <Fragment key={e.id}>
                  <tr className="hover:bg-slate-900/30 transition-colors">
                    <td className="p-4 font-semibold text-white">
                      <div>
                        <div>{e.user?.name || 'Anonymous User'}</div>
                        <span className="text-[10px] text-slate-400 font-mono select-all">{e.id}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border uppercase ${getStatusColor(e.status)}`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs font-mono uppercase text-slate-300">
                      {e.trigger_method.replace('_', ' ')}
                    </td>
                    <td className="p-4 font-medium text-slate-200">
                      {Math.floor((e.duration_seconds || 0) / 60)}m {e.duration_seconds ? e.duration_seconds % 60 : 0}s
                    </td>
                    <td className="p-4 text-center text-slate-300 font-bold">
                      {e.notified_count}
                    </td>
                    <td className="p-4 text-xs text-slate-400">
                      {new Date(e.started_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => toggleRow(e.id)}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-white bg-darkBg px-3 py-1.5 rounded-lg border border-darkBorder text-xs font-bold"
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Details
                      </button>
                    </td>
                  </tr>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} className="p-6 bg-darkBg/60 border-t border-b border-darkBorder">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-slate-300">
                          <div>
                            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3">Victim & Location Profile</h4>
                            <div className="space-y-2 bg-darkCard border border-darkBorder p-4 rounded-lg text-sm">
                              <div><span className="text-slate-400 font-semibold">Name:</span> {e.user?.name || 'Unknown'}</div>
                              <div><span className="text-slate-400 font-semibold">Phone:</span> {e.user?.phone || 'N/A'}</div>
                              <div><span className="text-slate-400 font-semibold">GPS Coordinates:</span> {e.location_lat.toFixed(5)}, {e.location_lng.toFixed(5)}</div>
                              <div><span className="text-slate-400 font-semibold">Resolution Type:</span> <span className="font-bold text-slate-200">{e.resolution_type || 'Active / Unresolved'}</span></div>
                            </div>
                          </div>

                          <div>
                            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3">Volunteer Responder Feeds</h4>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                              {loadingDetails ? (
                                <div className="text-xs text-slate-400">Loading live response statuses...</div>
                              ) : volunteersResponded.length === 0 ? (
                                <div className="text-xs text-slate-400 italic">No volunteers have responded to this incident yet.</div>
                              ) : (
                                volunteersResponded.map((vol, idx) => (
                                  <div key={idx} className="flex justify-between items-center bg-darkCard border border-darkBorder p-3 rounded-lg text-xs">
                                    <div>
                                      <div className="font-bold text-white">{vol.volunteer?.name || 'Volunteer'}</div>
                                      <span className="text-slate-400">Trust Score: {vol.volunteer?.trust_score || 50}/100</span>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                                      vol.status === 'completed'
                                        ? 'bg-emerald-950/40 text-emerald-500'
                                        : vol.status === 'accepted'
                                        ? 'bg-blue-950/40 text-blue-400'
                                        : 'bg-red-950/40 text-red-400'
                                    }`}>
                                      {vol.status}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            
            {events.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500 italic">
                  No SOS events match the selected filter parameters.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination Console */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center px-6 py-4 border-t border-darkBorder bg-slate-900/20">
            <span className="text-xs text-slate-400">
              Showing page {currentPage} of {totalPages} ({events.length} total events)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((c) => Math.max(c - 1, 1))}
                disabled={currentPage === 1}
                className="px-3.5 py-1.5 rounded-lg border border-darkBorder bg-darkBg text-xs font-semibold hover:text-white disabled:opacity-50 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((c) => Math.min(c + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3.5 py-1.5 rounded-lg border border-darkBorder bg-darkBg text-xs font-semibold hover:text-white disabled:opacity-50 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
