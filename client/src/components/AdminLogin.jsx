import { useState } from 'react';
import { api, setAdminSecret } from '../services/api.js';

export default function AdminLogin({ onSignedIn }) {
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setChecking(true);
    setMessage('');
    setAdminSecret(secret);
    try {
      await api.verifySecret();
      onSignedIn();
    } catch (error) {
      setAdminSecret('');
      setMessage(error.status === 401 ? 'Incorrect admin secret.' : error.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="plain-page">
      <h1>Admin sign-in</h1>
      <p>This server requires the admin secret (ADMIN_SECRET in the .env file).</p>
      <form onSubmit={handleSubmit} className="stacked-form">
        <label>
          Admin secret
          <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoFocus required />
        </label>
        <button type="submit" disabled={checking}>
          Sign in
        </button>
        {message && <p className="form-message-error">{message}</p>}
      </form>
    </main>
  );
}
