import React from 'react';
import VideoPlayer from './VideoPlayer';
import AudioPlayer from './AudioPlayer';
import PdfViewer from './PdfViewer';
import ImageViewer from './ImageViewer';


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
                    <ImageViewer 
                        fileId={file.id} 
                        fileName={file.name} 
                        token={token} 
                        onNext={onNext}
                        onPrev={onPrev}
                    />
                ) : isVideo ? (
                    <VideoPlayer
                        fileId={file.id}
                        token={token}
                        fileSize={file.size}
                        isIdle={isIdle}
                        onNext={onNext}
                        onPrev={onPrev}
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
                    <PdfViewer 
                        fileUrl={previewUrl} 
                        fileName={file.name} 
                        isIdle={isIdle}
                        onNext={onNext}
                        onPrev={onPrev}
                    />
                ) : file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.log') ? (
                    <div className="viewer-text-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {onPrev && (
                            <button className="nav-arrow prev-arrow" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                            </button>
                        )}
                        <iframe
                            src={previewUrl}
                            className="viewer-text-frame"
                            title={file.name}
                        />
                        {onNext && (
                            <button className="nav-arrow next-arrow" onClick={(e) => { e.stopPropagation(); onNext(); }}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="viewer-generic">
                        {onPrev && (
                            <button className="nav-arrow prev-arrow" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                            </button>
                        )}
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
                        {onNext && (
                            <button className="nav-arrow next-arrow" onClick={(e) => { e.stopPropagation(); onNext(); }}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                            </button>
                        )}
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
