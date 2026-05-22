import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Props = {
  onAuthenticated: (token: string) => void;
};

export function StaffLoginPage({ onAuthenticated }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@nurturekidspediatrics.com');
  const [password, setPassword] = useState('Admin@12345');
  const [error, setError] = useState('');

  async function login() {
    setError('');
    try {
      const result = await api<{ token: string }>('/api/staff/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated(result.token);
      navigate('/staff/patients');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card mobile">
      <h2>Staff Login</h2>
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error ? <div className="error">{error}</div> : null}
      <button onClick={login}>Login</button>
    </div>
  );
}
