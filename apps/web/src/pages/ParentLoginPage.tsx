import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

type Props = {
  onAuthenticated: (token: string) => void;
};

export function ParentLoginPage({ onAuthenticated }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function login() {
    setError('');
    try {
      const result = await api<{ token: string }>('/api/parent/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated(result.token);
      navigate('/parent/dashboard');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card mobile">
      <h2>Parent Login</h2>
      <div className="field">
        <label>Gmail</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error ? <div className="error">{error}</div> : null}
      <button onClick={login}>Login</button>
      <p>
        Need to register from intake first? <Link to="/p/nurturekidspediatrics">Start intake</Link>
      </p>
    </div>
  );
}
