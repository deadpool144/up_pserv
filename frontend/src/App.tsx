import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import AuthScreen from './components/AuthScreen';
import Layout from './components/Layout';
import FileGrid from './components/FileGrid';
import type { FileData } from './components/FileCard';
import UploadModal from './components/UploadModal';
import { Routes, Route, useNavigate } from 'react-router-dom';
import ViewPage from './pages/ViewPage';
import PlaylistPage from './pages/PlaylistPage';
import PlaylistSidebar from './components/PlaylistSidebar';
import type { Playlist } from './components/PlaylistSidebar';

const App: React.FC = () => {
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [hasUserKey, setHasUserKey] = useState<boolean>(() => localStorage.getItem('hasUserKey') === 'true');
    const [currentView, setCurrentView] = useState('all');
    const [files, setFiles] = useState<FileData[]>([]);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [showUpload, setShowUpload] = useState(false);
    const [addingToFile, setAddingToFile] = useState<FileData | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const navigate = useNavigate();

    const showStatus = (msg: string) => {
        setStatusMsg(msg);
        setTimeout(() => setStatusMsg(null), 3000);
    };

    const handleLogout = useCallback(() => {
        setToken(null);
        setHasUserKey(false);
        localStorage.removeItem('token');
        localStorage.removeItem('hasUserKey');
    }, []);

    const fetchPlaylists = useCallback(async () => {
        if (!token) return;
        try {
            const response = await fetch(`/api/playlists?token=${token}`);
            const data = await response.json();
            if (response.ok) setPlaylists(data);
        } catch (err) {
            console.error('Playlists fail:', err);
        }
    }, [token]);

    const fetchFiles = useCallback(async () => {
        if (!token) return;
        try {
            const response = await fetch(`/api/files?token=${token}&type=${currentView}`);
            const data = await response.json();
            if (response.ok) {
                setFiles(data.items);
            } else if (response.status === 401) {
                handleLogout();
            }
        } catch (err) {
            console.error('Files fail:', err);
        }
    }, [token, currentView, handleLogout]);

    useEffect(() => {
        fetchFiles();
        fetchPlaylists();
    }, [fetchFiles, fetchPlaylists]);

    // Live Push: Automatically refresh gallery when background processing finishes
    useEffect(() => {
        if (!token) return;

        const es = new EventSource(`/api/events?token=${token}`);
        
        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'file_ready') {
                    console.log('[SSE] File ready signal received:', data.id);
                    fetchFiles();
                }
            } catch (err) {
                console.error('[SSE] Event parse error:', err);
            }
        };

        es.onerror = (err) => {
            console.warn('[SSE] EventSource encountered an error, likely a temporary reconnect or auth issue.');
            // Most browsers auto-reconnect SSE, but we close to be safe on auth fail
            if (token === null) es.close();
        };

        return () => es.close();
    }, [token, fetchFiles]);

    const handleCreatePlaylist = async (name: string) => {
        try {
            const response = await fetch(`/api/playlists?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (response.ok) {
                fetchPlaylists();
                showStatus("Playlist created!");
            }
        } catch (err) { console.error('Create fail:', err); }
    };

    const handleDeletePlaylist = async (id: string) => {
        if (!window.confirm('Delete this playlist?')) return;
        try {
            const response = await fetch(`/api/playlists/${id}?token=${token}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                fetchPlaylists();
                showStatus("Playlist deleted");
                if (window.location.pathname.includes(id)) navigate('/');
            }
        } catch (err) { console.error('Delete PL fail:', err); }
    };

    const handleLogin = (newToken: string, huk: boolean) => {
        setToken(newToken);
        setHasUserKey(huk);
        localStorage.setItem('token', newToken);
        localStorage.setItem('hasUserKey', huk ? 'true' : 'false');
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Delete this file?')) return;
        try {
            const response = await fetch(`/api/delete/${id}?token=${token}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                fetchFiles();
                showStatus("File deleted");
            }
        } catch (err) { console.error('Delete fail:', err); }
    };

    const handleAddToPlaylist = (file: FileData) => {
        if (playlists.length === 0) {
            showStatus("Create a playlist first!");
            return;
        }
        
        // If only one playlist, add automatically
        if (playlists.length === 1) {
            performAddToPlaylist(playlists[0].id, playlists[0].name, file);
            return;
        }

        setAddingToFile(file);
    };

    const performAddToPlaylist = async (playlistId: string, playlistName: string, fileOverride?: FileData) => {
        const targetFile = fileOverride || addingToFile;
        if (!targetFile) return;
        try {
            const res = await fetch(`/api/playlists/${playlistId}/add?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: targetFile.id })
            });
            if (res.ok) {
                showStatus(`Added to ${playlistName}`);
                fetchPlaylists();
                setAddingToFile(null);
            }
        } catch (err) { console.error("Add fail:", err); }
    };

    const handleViewChange = (view: string) => {
        setCurrentView(view);
        navigate('/');
    };

    if (!token) {
        return <AuthScreen onLogin={handleLogin} />;
    }

    return (
        <>
            <Routes>
                <Route path="/" element={
                    <Layout 
                        currentView={currentView} 
                        onViewChange={handleViewChange} 
                        onLogout={handleLogout}
                        onUploadClick={() => setShowUpload(true)}
                        playlistSidebar={
                            <PlaylistSidebar 
                                playlists={playlists}
                                onCreate={handleCreatePlaylist}
                                onDelete={handleDeletePlaylist}
                                onSelect={(pid) => navigate(`/playlist/${pid}`)}
                            />
                        }
                    >
                        <FileGrid 
                            files={files} 
                            onView={(file) => navigate(`/view/${file.id}?type=${currentView}`)} 
                            onDelete={handleDelete} 
                            onAddToPlaylist={handleAddToPlaylist}
                            token={token}
                            viewTitle={currentView === 'all' ? 'All Files' : currentView.charAt(0).toUpperCase() + currentView.slice(1)}
                        />
                    </Layout>
                } />
                <Route path="/view/:id" element={<ViewPage token={token} />} />
                <Route path="/playlist/:id" element={
                    <Layout 
                        currentView="music" 
                        onViewChange={handleViewChange} 
                        onLogout={handleLogout}
                        onUploadClick={() => setShowUpload(true)}
                        playlistSidebar={
                            <PlaylistSidebar 
                                playlists={playlists}
                                onCreate={handleCreatePlaylist}
                                onDelete={handleDeletePlaylist}
                                onSelect={(pid) => navigate(`/playlist/${pid}`)}
                            />
                        }
                    >
                        <PlaylistPage 
                            token={token} 
                            playlists={playlists}
                            onRefresh={() => { fetchFiles(); fetchPlaylists(); }}
                        />
                    </Layout>
                } />
            </Routes>

            {showUpload && (
                <UploadModal
                    token={token}
                    hasUserKey={hasUserKey}
                    onClose={() => setShowUpload(false)}
                    onUploadComplete={() => { fetchFiles(); fetchPlaylists(); }}
                />
            )}

            {addingToFile && (
                <div className="modal" onClick={() => setAddingToFile(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setAddingToFile(null)}>&times;</button>
                        <div className="playlist-header">
                            <h3>Add to Playlist</h3>
                            <p className="file-meta" style={{ marginTop: '0.5rem' }}>{addingToFile.name}</p>
                        </div>
                        <div className="playlist-list" style={{ maxHeight: '400px' }}>
                            {playlists.map(p => (
                                <div 
                                    key={p.id} 
                                    className="playlist-item"
                                    onClick={() => performAddToPlaylist(p.id, p.name)}
                                >
                                    <div className="pl-info">
                                        <span className="pl-name">{p.name}</span>
                                        <span className="pl-count">{p.items.length} tracks</span>
                                    </div>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {statusMsg && (
                <div className="status-toast">
                    <div className="toast-inner">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        <span>{statusMsg}</span>
                    </div>
                </div>
            )}
        </>
    );
};

export default App;
