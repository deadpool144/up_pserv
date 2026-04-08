import React, { useState } from 'react';

interface AuthScreenProps {
    onLogin: (token: string, hasUserKey: boolean) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
    const [key, setKey] = useState('');
    const [userKey, setUserKey] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        if (!key) return;
        setLoading(true);
        setError('');

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, userKey })
            });

            const data = await response.json();

            if (response.ok) {
                onLogin(data.token, !!data.hasUserKey);
            } else {
                setError(data.error || 'Incorrect access key');
            }
        } catch (err) {
            setError('Server connection failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <section id="auth-screen">
            <div className="auth-bg-orbs">
                <div className="orb orb-1"></div>
                <div className="orb orb-2"></div>
                <div className="orb orb-3"></div>
            </div>
            <div className="auth-card">
                <div className="auth-logo">
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M24 4L8 10v14c0 9.94 6.84 19.24 16 21.58C33.16 43.24 40 33.94 40 24V10L24 4z" fill="url(#shield-grad)" />
                        <path d="M18 24l4 4 8-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        <defs>
                            <linearGradient id="shield-grad" x1="8" y1="4" x2="40" y2="46" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#8b5cf6" />
                                <stop offset="1" stopColor="#06b6d4" />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <h1 className="auth-title">SecurVault</h1>
                <p className="auth-sub">End-to-end encrypted media server</p>
                {error && <div className="auth-error">{error}</div>}
                <input
                    type="password"
                    id="key-input"
                    placeholder="Master Access Key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                <input
                    type="password"
                    id="user-key-input"
                    placeholder="Personal Encryption Key (Your secret)"
                    value={userKey}
                    onChange={(e) => setUserKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button
                    id="btn-login"
                    className="btn-primary"
                    onClick={handleLogin}
                    disabled={loading}
                >
                    {!loading ? (
                        <span>Unlock Vault</span>
                    ) : (
                        <span className="btn-spinner"></span>
                    )}
                </button>
                <p className="auth-hint">🔒 AES-256 encrypted · Local network only</p>
            </div>
        </section>
    );
};

export default AuthScreen;
