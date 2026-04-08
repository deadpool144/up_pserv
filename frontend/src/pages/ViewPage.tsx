import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Viewer from '../components/Viewer';
import type { FileData } from '../components/FileCard';

interface ViewPageProps {
    token: string;
}

const ViewPage: React.FC<ViewPageProps> = ({ token }) => {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const playlistId = searchParams.get('playlist');
    const viewType = searchParams.get('type');

    const navigate = useNavigate();
    const [file, setFile] = useState<FileData | null>(null);
    const [queue, setQueue] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchContext = async () => {
            setLoading(true);
            try {
                const response = await fetch(`/api/file/${id}?token=${token}`);
                if (!response.ok) throw new Error('File not found');
                const data = await response.json();
                setFile(data);

                if (playlistId) {
                    const plRes = await fetch(`/api/playlists?token=${token}`);
                    const playlists = await plRes.json();
                    const currentPl = playlists.find((p: any) => p.id === playlistId);
                    if (currentPl) setQueue(currentPl.items);
                } else if (viewType) {
                    const res = await fetch(`/api/files?token=${token}&type=${viewType}`);
                    const listData = await res.json();
                    if (res.ok) setQueue(listData.items.map((f: any) => f.id));
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        if (id && token) fetchContext();
    }, [id, token, playlistId, viewType]);

    const handleNext = () => {
        if (queue.length === 0) return;
        const currentIdx = queue.indexOf(id!);
        if (currentIdx !== -1 && currentIdx < queue.length - 1) {
            const nextId = queue[currentIdx + 1];
            const params = playlistId ? `?playlist=${playlistId}` : `?type=${viewType}`;
            navigate(`/view/${nextId}${params}`);
        } else if (currentIdx === queue.length - 1) {
            navigate(playlistId ? `/playlist/${playlistId}` : '/');
        }
    };

    const handlePrev = () => {
        if (queue.length === 0) return;
        const currentIdx = queue.indexOf(id!);
        if (currentIdx > 0) {
            const prevId = queue[currentIdx - 1];
            const params = playlistId ? `?playlist=${playlistId}` : `?type=${viewType}`;
            navigate(`/view/${prevId}${params}`);
        }
    };

    const handleDelete = async (fileId: string) => {
        try {
            const response = await fetch(`/api/delete/${fileId}?token=${token}`, { method: 'DELETE' });
            if (response.ok) navigate('/');
        } catch (err) {
            console.error('Delete failed:', err);
        }
    };

    if (loading) {
        return (
            <div className="vp-loading">
                <div className="vp-loading-inner">
                    <div className="vp-spinner"></div>
                    <span className="vp-loading-text">Locating Entry...</span>
                </div>
            </div>
        );
    }

    if (error || !file) {
        return (
            <div className="vp-error">
                <div className="vp-error-inner">
                    <div className="vp-error-code">ERROR_404</div>
                    <p className="vp-error-msg">
                        Vault entry not found or corrupted within the encrypted sector.
                    </p>
                    <button className="vp-error-btn" onClick={() => navigate('/')}>
                        Return to Vault
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="view-page-container">
            <Viewer
                file={file}
                token={token}
                onClose={() => navigate(playlistId ? `/playlist/${playlistId}` : '/')}
                onDelete={handleDelete}
                onNext={handleNext}
                onPrev={handlePrev}
            />
        </div>
    );
};

export default ViewPage;
