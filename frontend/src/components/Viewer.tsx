import React from 'react';
import VideoPlayer from './VideoPlayer';
import AudioPlayer from './AudioPlayer';

interface ViewerProps {
    file: {
        id: string;
        name: string;
        type: string;
        size: number;
    };
    token: string;
    onClose: () => void;
    onDelete?: (id: string) => void;
    onNext?: () => void;
    onPrev?: () => void;
}

const Viewer: React.FC<ViewerProps> = ({ file, token, onClose, onDelete, onNext, onPrev }) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mkv');
    const isAudio = file.type.startsWith('audio/') ||
        ['.mp3', '.flac', '.wav', '.m4a', '.ogg'].some(ext => file.name.toLowerCase().endsWith(ext));
    const isPDF = file.type.includes('pdf');

    const viewerRef = React.useRef<HTMLDivElement>(null);
    const [isIdle, setIsIdle] = React.useState(false);
    const [imgError, setImgError] = React.useState(false);
    const idleTimerRef = React.useRef<any>(null);

    const resetIdleTimer = () => {
        setIsIdle(false);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => setIsIdle(true), 3000);
    };

    React.useEffect(() => {
        resetIdleTimer();
        window.addEventListener('mousemove', resetIdleTimer);
        window.addEventListener('touchstart', resetIdleTimer);
        return () => {
            window.removeEventListener('mousemove', resetIdleTimer);
            window.removeEventListener('touchstart', resetIdleTimer);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
    }, []);

    const previewUrl = `/api/preview/${file.id}?token=${token}`;

    return (
        <div
            className={`viewer-overlay ${isIdle ? 'ui-hidden' : 'ui-visible'}`}
            ref={viewerRef}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            {/* Top action bar */}
            <div className={`viewer-actions ${isIdle ? 'actions-hidden' : 'actions-visible'}`} onClick={(e) => e.stopPropagation()}>
                <button className="viewer-action-btn" onClick={onClose} title="Close">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
                <a
                    className="viewer-action-btn"
                    href={`/api/download/${file.id}?token=${token}`}
                    download={file.name}
                    title="Download"
                    onClick={(e) => e.stopPropagation()}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5l5 5 5-5m-5 5V3" /></svg>
                </a>
                {onDelete && (
                    <button
                        className="viewer-action-btn viewer-action-danger"
                        onClick={() => { if (window.confirm('Confirm Deletion?')) onDelete(file.id); }}
                        title="Delete"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                )}
            </div>

            {/* Content area */}
            <div className={`viewer-content ${isPDF ? 'full-screen-doc' : ''}`}>
                {isImage ? (
                    imgError ? (
                        <div className="viewer-generic">
                            <div className="generic-icon">🖼️</div>
                            <div className="generic-name">{file.name}</div>
                            <div className="generic-size">Image failed to load</div>
                        </div>

                    ) : (
                        <img
                            src={previewUrl}
                            alt={file.name}
                            className="viewer-img no-copy-no-save"
                            onError={() => setImgError(true)}
                            onClick={(e) => e.stopPropagation()}
                            draggable={false}
                            onContextMenu={(e) => e.preventDefault()}
                        />

                    )
                ) : isVideo ? (
                    <VideoPlayer
                        fileId={file.id}
                        token={token}
                        fileSize={file.size}
                        isIdle={isIdle}
                    />
                ) : isAudio ? (
                    <AudioPlayer
                        fileId={file.id}
                        fileName={file.name}
                        token={token}
                        onNext={onNext}
                        onPrev={onPrev}
                    />
                ) : isPDF ? (
                    <div className="pdf-viewer-container no-copy-no-save">
                        <embed
                            src={previewUrl}
                            type="application/pdf"
                            className="viewer-pdf-embed"
                            title={file.name}
                            onContextMenu={(e) => e.preventDefault()}
                        />
                        <div className="pdf-fallback">
                            <span>PDF Viewer Active</span>
                        </div>
                    </div>

                ) : file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.log') ? (
                    <div className="viewer-text-container">
                        <iframe
                            src={previewUrl}
                            className="viewer-text-frame"
                            title={file.name}
                        />
                    </div>
                ) : (
                    <div className="viewer-generic">
                        <div className="generic-icon">📄</div>
                        <div className="generic-name">{file.name}</div>
                        <div className="generic-size">{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                        <a
                            href={`/api/download/${file.id}?token=${token}`}
                            className="download-btn-large"
                            onClick={(e) => e.stopPropagation()}
                        >
                            Download File
                        </a>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className={`viewer-footer ${isIdle ? 'footer-hidden' : 'footer-visible'}`} onClick={(e) => e.stopPropagation()}>
                <div className="viewer-file-info">
                    <span className="file-name">{file.name}</span>
                    <span className="file-dot">•</span>
                    <span className="file-size">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
            </div>
        </div>
    );
};

export default Viewer;
