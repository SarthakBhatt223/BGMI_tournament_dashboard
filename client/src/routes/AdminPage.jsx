import { useCallback, useEffect, useState } from 'react';
import AdminLogin from '../components/AdminLogin.jsx';
import AppHeader from '../components/AppHeader.jsx';
import BackupPanel from '../components/BackupPanel.jsx';
import BroadcastControls from '../components/BroadcastControls.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import MatchControls from '../components/MatchControls.jsx';
import PlayerList from '../components/PlayerList.jsx';
import RosterManager from '../components/RosterManager.jsx';
import SettingsPanel from '../components/SettingsPanel.jsx';
import TeamTable from '../components/TeamTable.jsx';
import { useActionRunner } from '../hooks/useActionRunner.js';
import { useTournamentState } from '../hooks/useTournamentState.js';
import { api, getAdminSecret, setAdminSecret } from '../services/api.js';
import { BROADCAST_MODE_LABELS, describeMatch } from '../utils/formatters.js';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['scoring', 'Scoring'],
  ['roster', 'Roster'],
  ['players', 'Player stats'],
  ['broadcast', 'Broadcast'],
  ['settings', 'Settings'],
  ['backup', 'Backup'],
];

function Dashboard({ state, connection, onOpenTab }) {
  const incompleteTeams = state.teams.filter(
    (team) => team.active && team.playerCount < state.config.roster.playersPerTeam,
  );
  return (
    <div className="panel-stack">
      <section className="panel">
        <h2>Overview</h2>
        <dl className="facts">
          <div><dt>Event</dt><dd>{state.event.name}</dd></div>
          <div><dt>Teams</dt><dd>{state.counts.teams}</dd></div>
          <div><dt>Players</dt><dd>{state.counts.players}</dd></div>
          <div><dt>Current match</dt><dd>{describeMatch(state.currentMatch?.match)}</dd></div>
          <div><dt>Display mode</dt><dd>{BROADCAST_MODE_LABELS[state.broadcast.mode]}</dd></div>
          <div><dt>Connection</dt><dd>{connection}</dd></div>
        </dl>
        <div className="button-group">
          <button type="button" onClick={() => onOpenTab('scoring')}>Go to scoring</button>
          <button type="button" className="button-secondary" onClick={() => onOpenTab('roster')}>Manage roster</button>
          <button type="button" className="button-secondary" onClick={() => onOpenTab('broadcast')}>Broadcast controls</button>
        </div>
        {incompleteTeams.length > 0 && (
          <p className="form-message-warning">
            {incompleteTeams.length} team(s) have fewer than {state.config.roster.playersPerTeam} players: {incompleteTeams.map((team) => team.name).join(', ')}.
          </p>
        )}
        {!state.media.ambientVideoAvailable && (
          <p className="form-message-warning">Ambient video not found at {state.media.ambientVideoUrl} (see public/media/README.md).</p>
        )}
      </section>
      <section className="panel">
        <h2>Standings</h2>
        <TeamTable rows={state.standings} />
      </section>
    </div>
  );
}

function AdminWorkspace({ onSignOut }) {
  const { state, connection, refresh } = useTournamentState();
  const [activeTab, setActiveTab] = useState('dashboard');

  // If the live connection is down, fetch the new state over HTTP after each change.
  const refreshWhenDisconnected = useCallback(async () => {
    if (connection !== 'connected') await refresh();
  }, [connection, refresh]);
  const { run, busy, error, clearError } = useActionRunner({ onSuccess: refreshWhenDisconnected });

  useEffect(() => {
    if (error?.status === 401) onSignOut();
  }, [error, onSignOut]);

  if (!state) {
    return (
      <>
        <AppHeader connection={connection} />
        <main className="admin-main">
          <p>Loading tournament state...</p>
        </main>
      </>
    );
  }

  // All tabs stay mounted (only hidden) so half-entered selections are never discarded.
  return (
    <>
      <AppHeader eventName={state.event.name} connection={connection} onSignOut={getAdminSecret() ? onSignOut : undefined} />
      <nav className="tab-bar" aria-label="Admin sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={activeTab === id ? 'tab-active' : 'tab'} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="admin-main">
        <ErrorBanner error={error} onDismiss={clearError} />
        <div hidden={activeTab !== 'dashboard'}><Dashboard state={state} connection={connection} onOpenTab={setActiveTab} /></div>
        <div hidden={activeTab !== 'scoring'}><MatchControls state={state} run={run} busy={busy} /></div>
        <div hidden={activeTab !== 'roster'}><RosterManager state={state} run={run} busy={busy} /></div>
        <div hidden={activeTab !== 'players'}><PlayerList playerStats={state.playerStats} /></div>
        <div hidden={activeTab !== 'broadcast'}><BroadcastControls state={state} run={run} busy={busy} /></div>
        <div hidden={activeTab !== 'settings'}><SettingsPanel state={state} run={run} busy={busy} /></div>
        <div hidden={activeTab !== 'backup'}><BackupPanel run={run} busy={busy} /></div>
      </main>
    </>
  );
}

export default function AdminPage() {
  const [authStatus, setAuthStatus] = useState('checking'); // checking | needsLogin | ready | unreachable

  const checkAuth = useCallback(async () => {
    try {
      const health = await api.health();
      if (!health.authRequired) return setAuthStatus('ready');
      if (!getAdminSecret()) return setAuthStatus('needsLogin');
      await api.verifySecret();
      return setAuthStatus('ready');
    } catch (error) {
      if (error.status === 401) {
        setAdminSecret('');
        return setAuthStatus('needsLogin');
      }
      return setAuthStatus('unreachable');
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const signOut = useCallback(() => {
    setAdminSecret('');
    setAuthStatus('needsLogin');
  }, []);

  if (authStatus === 'checking') return <main className="plain-page"><p>Checking server...</p></main>;
  if (authStatus === 'unreachable') {
    return (
      <main className="plain-page">
        <h1>Cannot reach the server</h1>
        <p>Start it with <code>npm run dev</code> and reload this page.</p>
        <button type="button" onClick={checkAuth}>Try again</button>
      </main>
    );
  }
  if (authStatus === 'needsLogin') return <AdminLogin onSignedIn={() => setAuthStatus('ready')} />;
  return <AdminWorkspace onSignOut={signOut} />;
}
