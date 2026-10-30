import { useCallback, useEffect, useState } from 'react';
import AdminLogin from '../components/AdminLogin.jsx';
import AppHeader from '../components/AppHeader.jsx';
import BackupPanel from '../components/BackupPanel.jsx';
import Dashboard from '../components/Dashboard.jsx';
import BroadcastControls from '../components/BroadcastControls.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import MatchControls from '../components/MatchControls.jsx';
import PlayerFinishAudit from '../components/PlayerFinishAudit.jsx';
import PlayerList from '../components/PlayerList.jsx';
import RosterManager from '../components/RosterManager.jsx';
import SettingsPanel from '../components/SettingsPanel.jsx';
import TopNav from '../components/TopNav.jsx';
import { useActionRunner } from '../hooks/useActionRunner.js';
import { useKeyedActions } from '../hooks/useKeyedActions.js';
import { useTournamentState } from '../hooks/useTournamentState.js';
import { api, getAdminSecret, setAdminSecret } from '../services/api.js';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['scoring', 'Scoring'],
  ['audit', 'Player Finish Audit'],
  ['roster', 'Roster'],
  ['players', 'Player Stats'],
  ['broadcast', 'Broadcast'],
  ['settings', 'Settings'],
  ['backup', 'Backup'],
];

// One-line status for the header, taken from what the server reports.
function describeSystemStatus(state) {
  const match = state.currentMatch?.match;
  if (!match) return 'No match selected';
  const status = match.status === 'in_progress' ? 'In progress' : match.status === 'finalized' ? 'Finalized' : 'Planned';
  return `Match ${match.matchNumber} - ${status}`;
}

function AdminWorkspace({ onSignOut }) {
  const { state, connection, refresh } = useTournamentState();
  const [activeTab, setActiveTab] = useState('dashboard');

  // If the live connection is down, fetch the new state over HTTP after each change.
  const refreshWhenDisconnected = useCallback(async () => {
    if (connection !== 'connected') await refresh();
  }, [connection, refresh]);
  const { run, busy, error, clearError } = useActionRunner({ onSuccess: refreshWhenDisconnected });
  // Row-level actions (team and player +/-) run without locking the page, so quick repeated clicks all count.
  const keyed = useKeyedActions({ onSuccess: refreshWhenDisconnected });

  useEffect(() => {
    if (error?.status === 401 || keyed.lastError?.status === 401) onSignOut();
  }, [error, keyed.lastError, onSignOut]);

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
      <AppHeader
        eventName={state.event.name}
        connection={connection}
        systemStatus={describeSystemStatus(state)}
        onSignOut={getAdminSecret() ? onSignOut : undefined}
      />
      <TopNav tabs={TABS} activeTab={activeTab} onSelect={setActiveTab} />
      <main className="admin-main">
        <ErrorBanner error={error} onDismiss={clearError} />
        <ErrorBanner error={keyed.lastError} onDismiss={keyed.clearError} />
        <div hidden={activeTab !== 'dashboard'}><Dashboard state={state} connection={connection} onOpenTab={setActiveTab} /></div>
        <div hidden={activeTab !== 'scoring'}>
          <MatchControls state={state} run={run} busy={busy} runFor={keyed.runFor} statuses={keyed.statuses} />
        </div>
        <div hidden={activeTab !== 'audit'}>
          <PlayerFinishAudit state={state} run={run} busy={busy} runFor={keyed.runFor} statuses={keyed.statuses} />
        </div>
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
