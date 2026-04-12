import React from 'react';

export interface FileData {
    id: string;
    name: string;
    size: number;
    type: string;
    thumb: boolean;
    created: number;
    status?: 'ready' | 'processing' | 'error';
    /** 0=plaintext, 1=master-key, 2=personal-key */
    encLevel?: number;
    /** false = current user cannot decrypt this file */
    accessible?: boolean;
    subtitles?: { index: number, label: string, lang: string }[];
}

interface FileCardProps {
    file: FileData;
    onView: (file: FileData) => void;
    onDelete: (id: string | any) => void;
    onAddToPlaylist?: (file: FileData) => void;
    token: string;
}

const FileCard: React.FC<FileCardProps> = ({ file, onView, onDelete, onAddToPlaylist, token }) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/') || file.type.includes('matroska') || file.name.toLowerCase().endsWith('.mkv');

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const isProcessing = file.status === 'processing';
    const isAccessible = file.accessible !== false; // default true if undefined
    const encLvl = file.encLevel ?? 1;

    return (
        <div
            className={`file-card ${isProcessing ? 'card-processing' : ''} ${!isAccessible ? 'card-locked' : ''}`}
            onClick={() => isAccessible && !isProcessing && onView(file)}
            title={!isAccessible ? 'Personal Key required to view this file' : undefined}
        >
            <div className="card-thumb">
                {file.thumb && isAccessible ? (
                    <img
                        src={`/api/thumbnail/${file.id}?token=${token}`}
                        alt={file.name}
                        loading="lazy"
                        className="no-copy-no-save"
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                    />

                ) : (
                    <div className="file-icon">
                        {!isAccessible
                            ? '🔐'
                            : isVideo ? '🎬'
                            : isImage ? '🖼️'
                            : file.type.includes('pdf') ? '📑'
                            : file.type.startsWith('audio/') ? '🎵'
                            : '📄'}
                    </div>
                )}

                {/* Video play overlay */}
                {isVideo && !isProcessing && isAccessible && (
                    <div className="play-overlay">
                        <div className="play-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                    </div>
                )}

                {/* Processing overlay */}
                {isProcessing && (
                    <div className="processing-overlay">
                        <div className="loader-mini"></div>
                        <span>Processing…</span>
                    </div>
                )}

                {/* Locked overlay */}
                {!isAccessible && (
                    <div className="locked-overlay">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <span>Personal Key Required</span>
                    </div>
                )}

                {/* Enc level badge */}
                {isAccessible && encLvl === 2 && (
                    <div className="enc-badge enc-badge-l2" title="Personal-key encrypted">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <rect x="3" y="11" width="18" height="11" rx="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                    </div>
                )}

                {/* Inaccessible red dot */}
                {!isAccessible && (
                    <div className="enc-badge enc-badge-locked" title="Requires personal key"/>
                )}

                {/* Actions: inside thumb */}
                {isAccessible && !isProcessing && (
                    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                        {onAddToPlaylist && file.type.startsWith('audio/') && (
                            <button
                                className="action-btn"
                                onClick={(e) => { e.stopPropagation(); onAddToPlaylist(file); }}
                                title="Add to Playlist"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                            </button>
                        )}
                        <button
                            className="action-btn"
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                const link = document.createElement('a');
                                link.href = `/api/download/${file.id}?token=${token}`;
                                link.download = file.name;
                                link.click();
                            }}

                            title="Download"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                        <button
                            className="action-btn btn-del"
                            onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
                            title="Delete"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                )}

                {/* Delete-only action for locked files */}
                {!isAccessible && (
                    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="action-btn btn-del"
                            onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
                            title="Delete"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                )}
            </div>

            <div className="card-info">
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-meta">
                    {file.type.split('/')[1]?.toUpperCase() || 'FILE'} · {formatSize(file.size)}
                    {isProcessing && <span className="processing-tag"> · ⚙ Processing</span>}
                    {!isAccessible && <span className="locked-tag"> · 🔐 Locked</span>}
                </span>
            </div>
        </div>
    );
};

export default FileCard;
