import React, { useEffect, useState, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import './styles.css';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function useQueryParam(name) {
  const [value, setValue] = useState(() => {
    try { return new URLSearchParams(location.search).get(name); } catch { return null; }
  });
  useEffect(() => {
    const onPop = () => setValue(new URLSearchParams(location.search).get(name));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [name]);
  return [value];
}

export default function App() {
  const [token] = useQueryParam('t');
  const [player, setPlayer] = useState(null);
  const [timeslots, setTimeslots] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [matches, setMatches] = useState([]);
  const [playersMap, setPlayersMap] = useState({});

  useEffect(() => { fetchAll(); setupRealtime(); }, []);

  async function fetchAll() {
    const [{ data: ts }, { data: av }, { data: m }, { data: ps }] = await Promise.all([
      supabase.from('timeslots').select('*').order('slot_date').order('period'),
      supabase.from('availability').select('*'),
      supabase.from('matches').select('*'),
      supabase.from('players').select('*'),
    ]);
    setTimeslots(ts || []);
    setAvailability(av || []);
    setMatches(m || []);
    const map = {};
    (ps || []).forEach(p => { map[p.id] = p; });
    setPlayersMap(map);

    if (token) {
      const match = (ps || []).find(p => p.share_token && p.share_token.toString() === token);
      if (match) setPlayer(match);
    }
  }

  function setupRealtime(){
    const ch = supabase.channel('public:availability_matches_players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchAll())
      .subscribe();

    window.addEventListener('beforeunload', () => supabase.removeChannel(ch));
  }

  const myAvailByTimeslot = useMemo(() => {
    const m = {};
    availability.forEach(a => { if (player && a.player_id === player.id) m[a.timeslot_id] = a.id; });
    return m;
  }, [availability, player]);

  function matchForTimeslot(slotId) {
    return matches.find(x => x.timeslot_id === slotId);
  }

  async function toggleAvailability(ts) {
    if (!player) { alert('Use your personal link.'); return; }
    const existingId = myAvailByTimeslot[ts.id];
    if (existingId) {
      await supabase.from('availability').delete().eq('id', existingId);
      fetchAll();
    } else {
      await supabase.from('availability').insert({ player_id: player.id, timeslot_id: ts.id });
      fetchAll();
    }
  }

  const grouped = useMemo(() => {
    const g = {};
    timeslots.forEach(ts => { (g[ts.slot_date] = g[ts.slot_date] || []).push(ts); });
    return g;
  }, [timeslots]);

  return (
    <div className="page">
      <header className="header">
        <div className="title">Hurlingham Club — League Scheduler</div>
        <div className="sub">Mobile-friendly — tap to mark availability</div>
      </header>
      <main className="container">
        <section className="left">
          <div className="card">
            <h3>Your identity</h3>
            {player ? (
              <div className="player-box">
                <div className="player-name">{player.name}</div>
                <div className="small">Use this link again to edit: send your personal link to your phone</div>
              </div>
            ) : (
              <div className="notice">No valid token found in the link.</div>
            )}
          </div>
          <div className="card">
            <h3>Availability</h3>
            {Object.keys(grouped).length === 0 && <div>No timeslots. Ask admin to seed them.</div>}
            {Object.keys(grouped).map(date => (
              <div key={date} className="date-row">
                <div className="date-label">{dayjs(date).format('ddd, D MMM YYYY')}</div>
                <div className="periods">
                  {grouped[date].map(ts => {
                    const match = matchForTimeslot(ts.id);
                    const isMine = !!myAvailByTimeslot[ts.id];
                    const locked = !!match;
                    const matchPlayers = match ? [match.player1_id, match.player2_id] : [];

                    let cls = 'btn';
                    if (locked) {
                      if (player && matchPlayers.includes(player.id)) cls = 'btn locked-me';
                      else cls = 'btn locked';
                    } else if (isMine) cls = 'btn mine';
                    return (
                      <button key={ts.id} className={cls} onClick={() => { if (!locked) toggleAvailability(ts); }}>
                        <div className="period">{ts.period}</div>
                        <div className="meta">{locked ? 'Matched' : ''}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside className="right">
          <div className="card">
            <h3>Your matches</h3>
            {player ? (
              <div>
                {matches.filter(m => m.player1_id === player.id || m.player2_id === player.id).length === 0 && <div>No confirmed matches yet.</div>}
                <ul className="match-list">
                  {matches.filter(m => m.player1_id === player.id || m.player2_id === player.id).map(m => {
                    const p1 = playersMap[m.player1_id];
                    const p2 = playersMap[m.player2_id];
                    const ts = timeslots.find(t => t.id === m.timeslot_id);
                    return (
                      <li key={m.id} className="match-item">
                        <div className="match-title">{p1?.name} vs {p2?.name}</div>
                        <div className="match-meta">{ts ? `${dayjs(ts.slot_date).format('ddd, D MMM')} · ${ts.period}` : ''}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : <div className="notice">Open with your personal link to see your matches.</div>}
          </div>
        </aside>
      </main>
    </div>
  );
}
