import React, { useState } from 'react';

interface ImageViewerProps {
    fileId: string;
    fileName: string;
    token: string;
    onNext?: () => void;
    onPrev?: () => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ fileId, fileName, token, onNext, onPrev }) => {
    const [imgError, setImgError] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const previewUrl = `/api/preview/${fileId}?token=${token}`;

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    React.useEffect(() => {
        const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFsChange);
        return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

    return (
        <div 
            ref={containerRef}
            style={{ 
                position: 'relative', 
                width: '100%', 
                height: '100%', 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                background: isFullscreen ? '#000' : 'transparent'
            }}
        >
            {/* Nav arrows always accessible */}
            {onPrev && (
                <button className="nav-arrow prev-arrow" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
            )}

            {imgError ? (
                <div className="viewer-generic">
                    <div className="generic-icon">🖼️</div>
                    <div className="generic-name">{fileName}</div>
                    <div className="generic-size">Image failed to load or encrypted sector unreachable</div>
                </div>
            ) : (
                <img
                    src={previewUrl}
                    alt={fileName}
                    className={`viewer-img no-copy-no-save ${isFullscreen ? 'img-fs' : ''}`}
                    onError={() => setImgError(true)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={toggleFullscreen}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ 
                        maxHeight: '100%', 
                        maxWidth: '100%', 
                        objectFit: 'contain',
                        cursor: 'pointer'
                    }}
                />
            )}

            {/* Fullscreen toggle button for better UX */}
            <button 
                className="viewer-action-btn fs-toggle" 
                style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 101 }}
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                title="Toggle Fullscreen"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {isFullscreen ? (
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                    ) : (
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    )}
                </svg>
            </button>

            {onNext && (
                <button className="nav-arrow next-arrow" onClick={(e) => { e.stopPropagation(); onNext(); }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
            )}
        </div>
    );
};

export default ImageViewer;
