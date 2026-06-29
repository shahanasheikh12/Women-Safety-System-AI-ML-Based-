import { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Ban, Search, Download, Edit } from 'lucide-react';

interface Volunteer {
  id: string;
  name: string;
  phone: string;
  is_volunteer: boolean;
  verification_tier: number;
  trust_score: number;
  credits: number;
  stats?: {
    total_completed: number;
    avg_rating: number;
    total_false_reports: number;
  };
}

export default function Volunteers() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal for editing tier
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [newTier, setNewTier] = useState<number>(0);
  const [showTierModal, setShowTierModal] = useState(false);

  useEffect(() => {
    fetchVolunteers();
  }, [searchQuery]);

  const fetchVolunteers = async () => {
    try {
      // Query users who are volunteers
      let query = supabase
        .from('users')
        .select('id, name, phone, is_volunteer, verification_tier, trust_score, credits')
        .eq('is_volunteer', true)
        .order('trust_score', { ascending: false });

      if (searchQuery.trim()) {
        query = query.ilike('name', `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const enriched = await Promise.all(
        (data || []).map(async (vol: any) => {
          // Fetch stats from volunteer_stats table
          const { data: statsData } = await supabase
            .from('volunteer_stats')
            .select('total_completed, avg_rating, total_false_reports')
            .eq('volunteer_id', vol.id)
            .maybeSingle();

          return {
            ...vol,
            stats: statsData || { total_completed: 0, avg_rating: 5.0, total_false_reports: 0 },
          };
        })
      );

      setVolunteers(enriched);
    } catch (err) {
      console.error('Error fetching volunteers:', err);
    }
  };

  const handleUpdateTier = async () => {
    if (!selectedVolunteer) return;
    try {
      const { error } = await supabase
        .from('users')
        .update({ verification_tier: newTier })
        .eq('id', selectedVolunteer.id);

      if (error) throw error;

      // Close modal & reload
      setShowTierModal(false);
      setSelectedVolunteer(null);
      fetchVolunteers();
    } catch (err) {
      console.error('Error updating verification tier:', err);
    }
  };

  const handleSuspendAccount = async (vol: Volunteer) => {
    const confirm = window.confirm(`Are you sure you want to toggle volunteer privileges for ${vol.name}?`);
    if (!confirm) return;

    try {
      // Toggle is_volunteer status to suspend them from responding
      const { error } = await supabase
        .from('users')
        .update({ is_volunteer: !vol.is_volunteer })
        .eq('id', vol.id);

      if (error) throw error;
      fetchVolunteers();
    } catch (err) {
      console.error('Error suspending volunteer:', err);
    }
  };

  const exportList = () => {
    if (volunteers.length === 0) return;
    
    const headers = ['Volunteer ID', 'Name', 'Phone', 'Verification Tier', 'Trust Score', 'Total Assists', 'Avg Rating', 'Credits'];
    const rows = volunteers.map((v) => [
      v.id,
      v.name,
      v.phone,
      v.verification_tier,
      v.trust_score,
      v.stats?.total_completed || 0,
      v.stats?.avg_rating || 5.0,
      v.credits || 0,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SafeCircle_Volunteers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getTierBadgeColor = (tier: number) => {
    switch (tier) {
      case 3:
        return 'bg-red-950/40 text-red-400 border-red-800/40';
      case 2:
        return 'bg-amber-950/40 text-amber-400 border-amber-800/40';
      case 1:
        return 'bg-blue-950/40 text-blue-400 border-blue-800/40';
      default:
        return 'bg-slate-950/40 text-slate-400 border-slate-800/40';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-white">Volunteer Network</h1>
          <p className="text-slate-400 mt-1">Manage responder verifications, adjust tiers, and inspect trust score weights</p>
        </div>
        <button
          onClick={exportList}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 font-bold text-white text-sm transition-colors shadow-md"
        >
          <Download size={16} />
          Export List CSV
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex bg-darkCard border border-darkBorder p-4 rounded-xl items-center gap-3">
        <Search className="text-slate-400" size={18} />
        <input
          type="text"
          className="w-full bg-transparent text-slate-200 text-sm focus:outline-none"
          placeholder="Search volunteers by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Volunteers Table */}
      <div className="overflow-hidden border border-darkBorder bg-darkCard rounded-xl shadow-md">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-darkBorder bg-slate-900/50 text-slate-300 font-bold uppercase text-xs">
              <th className="p-4">Volunteer Info</th>
              <th className="p-4">Verification Tier</th>
              <th className="p-4 text-center">Trust Score</th>
              <th className="p-4 text-center">Assists Completed</th>
              <th className="p-4 text-center">Avg Rating</th>
              <th className="p-4 text-center">Credits Balance</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-darkBorder text-slate-300">
            {volunteers.map((vol) => (
              <tr key={vol.id} className="hover:bg-slate-900/30 transition-colors">
                <td className="p-4">
                  <div>
                    <div className="font-bold text-white">{vol.name}</div>
                    <span className="text-xs text-slate-400 font-mono">{vol.phone}</span>
                  </div>
                </td>
                <td className="p-4">
                  <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${getTierBadgeColor(vol.verification_tier)}`}>
                    🛡️ TIER {vol.verification_tier}
                  </span>
                </td>
                <td className="p-4 text-center font-bold text-slate-100">
                  <span className={`px-2 py-0.5 rounded font-mono ${
                    vol.trust_score >= 80
                      ? 'text-emerald-400 bg-emerald-950/20'
                      : vol.trust_score >= 50
                      ? 'text-amber-400 bg-amber-950/20'
                      : 'text-red-400 bg-red-950/20'
                  }`}>
                    {vol.trust_score.toFixed(1)}/100
                  </span>
                </td>
                <td className="p-4 text-center font-bold text-slate-200">
                  {vol.stats?.total_completed || 0}
                </td>
                <td className="p-4 text-center font-semibold text-slate-200">
                  ⭐ {vol.stats?.avg_rating?.toFixed(1) || '5.0'}
                </td>
                <td className="p-4 text-center text-amber-500 font-bold">
                  💰 {vol.credits || 0}
                </td>
                <td className="p-4 text-right space-x-2">
                  <button
                    onClick={() => {
                      setSelectedVolunteer(vol);
                      setNewTier(vol.verification_tier);
                      setShowTierModal(true);
                    }}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-white bg-darkBg px-3 py-1.5 rounded-lg border border-darkBorder text-xs font-bold"
                  >
                    <Edit size={12} />
                    Tier
                  </button>

                  <button
                    onClick={() => handleSuspendAccount(vol)}
                    className="inline-flex items-center gap-1 text-red-400 hover:text-white hover:bg-red-600 bg-red-950/20 px-3 py-1.5 rounded-lg border border-red-800/40 text-xs font-bold"
                  >
                    <Ban size={12} />
                    Suspend
                  </button>
                </td>
              </tr>
            ))}

            {volunteers.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500 italic">
                  No volunteers found matching your query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Upgrade Tier Modal */}
      {showTierModal && selectedVolunteer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-darkBorder bg-darkCard p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Adjust Verification Tier</h3>
            <p className="text-xs text-slate-400 mb-6">Manually override security level for {selectedVolunteer.name}.</p>

            <div className="space-y-3 mb-6">
              {[0, 1, 2, 3].map((tier) => (
                <button
                  type="button"
                  key={tier}
                  onClick={() => setNewTier(tier)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border ${
                    newTier === tier
                      ? 'border-red-500 bg-red-950/20 text-white'
                      : 'border-darkBorder bg-darkBg text-slate-300'
                  }`}
                >
                  <span className="font-bold text-sm">Tier {tier}</span>
                  <span className="text-[10px] text-slate-400">
                    {tier === 3 ? '🔴 Backed by Police / Auth' : tier === 2 ? '🟡 High-trust Responder' : tier === 1 ? '🔵 Fast Responder' : '⚪ Standard Volunteer'}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowTierModal(false);
                  setSelectedVolunteer(null);
                }}
                className="flex-1 rounded-lg bg-darkBorder py-2.5 font-bold text-slate-300 text-sm hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTier}
                className="flex-1 rounded-lg bg-red-600 py-2.5 font-bold text-white text-sm hover:bg-red-500"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
