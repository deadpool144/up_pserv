import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface LayoutProps {
    currentView: string;
    onViewChange: (view: string) => void;
    onLogout: () => void;
    onUploadClick: () => void;
    playlistSidebar?: React.ReactNode; 
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ 
    currentView, 
    onViewChange, 
    onLogout, 
    onUploadClick, 
    playlistSidebar,
    children 
}) => {
    const [isPlaylistOpen, setIsPlaylistOpen] = React.useState(false);
    const location = useLocation();

    // Auto-close sidebar on navigation
    useEffect(() => {
        setIsPlaylistOpen(false);
    }, [location.pathname, currentView]);

    // ── SECURITY ENFORCEMENT ──────────────────
    useEffect(() => {
        const preventDefault = (e: Event) => e.preventDefault();
        
        // Disable Right-Click
        window.addEventListener('contextmenu', preventDefault);
        // Disable Dragging (saving images by dragging)
        window.addEventListener('dragstart', preventDefault);
        // Disable Copy/Cut
        window.addEventListener('copy', preventDefault);
        window.addEventListener('cut', preventDefault);
        
        // Disable Save Page As (Ctrl+S) and Print (Ctrl+P)
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p')) {
                e.preventDefault();
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('contextmenu', preventDefault);
            window.removeEventListener('dragstart', preventDefault);
            window.removeEventListener('copy', preventDefault);
            window.removeEventListener('cut', preventDefault);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);


    const navItems = [
        // ... (unchanged)
        {
            id: 'all', label: 'All Files', icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            )
        },
        {
            id: 'videos', label: 'Videos', icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            )
        },
        {
            id: 'images', label: 'Images', icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            )
        },
        {
            id: 'music', label: 'Music', icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
            )
        },
        {
            id: 'files', label: 'Files', icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
            )
        }
    ];

    return (
        <section id="app-screen">
            <header className="topbar">
                <div className="topbar-brand">
                    <svg width="22" height="22" viewBox="0 0 48 48" fill="none"><path d="M24 4L8 10v14c0 9.94 6.84 19.24 16 21.58C33.16 43.24 40 33.94 40 24V10L24 4z" fill="url(#tb-grad)" /><path d="M18 24l4 4 8-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><defs><linearGradient id="tb-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stopColor="#8b5cf6" /><stop offset="1" stopColor="#06b6d4" /></linearGradient></defs></svg>
                    <span>SecurVault</span>
                </div>
                <div className="topbar-right">
                    <button 
                        className={`icon-btn ${isPlaylistOpen ? 'active-accent' : ''}`} 
                        title="Playlists" 
                        onClick={() => setIsPlaylistOpen(!isPlaylistOpen)}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20v-6M9 17v-3M15 17v-3M2 4h20v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4zM2 8h20" /></svg>
                    </button>
                    <button className="icon-btn" title="Logout" onClick={onLogout}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    </button>
                </div>
            </header>

            <div className="app-body">
                <aside className="sidebar">
                    <nav className="sidebar-nav">
                        {navItems.map(item => (
                            <button
                                key={item.id}
                                className={`nav-btn ${currentView === item.id ? 'active' : ''}`}
                                onClick={() => onViewChange(item.id)}
                            >
                                {item.icon}
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </nav>
                    <button id="btn-upload-desktop" className="upload-btn-sidebar" onClick={onUploadClick}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /></svg>
                        Upload File
                    </button>
                    <div className="sidebar-status">
                        <div className="status-dot"></div>
                        <span>Encrypted · Local</span>
                    </div>
                </aside>

                <main className="main-content">
                    {children}
                </main>

                {isPlaylistOpen && (
                    <div 
                        className="playlist-overlay" 
                        onClick={() => setIsPlaylistOpen(false)}
                        style={{
                            position: 'fixed',
                            top: 0, left: 0, right: 0, bottom: 0,
                            background: 'transparent',
                            zIndex: 90
                        }}
                    />
                )}

                <aside className={`right-sidebar ${isPlaylistOpen ? 'open' : ''}`}>
                    {playlistSidebar}
                </aside>
            </div>

            <nav className="bottom-nav">
                {navItems.map(item => (
                    <button
                        key={item.id}
                        className={`nav-btn ${currentView === item.id ? 'active' : ''}`}
                        onClick={() => onViewChange(item.id)}
                    >
                        {item.icon}
                        <span>{item.id === 'all' ? 'All' : item.label}</span>
                    </button>
                ))}
            </nav>

            <button id="btn-upload-mobile" className="fab" onClick={onUploadClick}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
        </section>
    );
};

export default Layout;
