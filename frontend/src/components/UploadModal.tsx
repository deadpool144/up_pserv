import React, { useState } from 'react';

interface UploadModalProps {
    onClose: () => void;
    onUploadComplete: () => void;
    token: string;
    hasUserKey: boolean;   // true = session has a personal key → level 2 available
}

const UploadModal: React.FC<UploadModalProps> = ({ onClose, onUploadComplete, token, hasUserKey }) => {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [encLevel, setEncLevel] = useState<0 | 1 | 2>(1);   // default: vault key
    const [shouldRandomize, setShouldRandomize] = useState(true);
    const [dragOver, setDragOver] = useState(false);

    const isAudio = file ? (file.type.startsWith('audio/') ||
        ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac'].some(e => file.name.toLowerCase().endsWith(e))) : false;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) setFile(e.target.files[0]);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        setProgress(0);

        const fileId = 'ul_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const effectiveLevel = isAudio ? 0 : encLevel;

        const CHUNK_SIZE = 4 * 1024 * 1024;  // 4 MB chunks — fast enough on LAN, no race conditions
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        try {
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                const formData = new FormData();
                formData.append('chunk', chunk);
                formData.append('file_id', fileId);
                formData.append('chunk_index', i.toString());
                formData.append('total_chunks', totalChunks.toString());
                formData.append('filename', file.name);
                formData.append('offset', start.toString());
                formData.append('enc_level', effectiveLevel.toString());
                formData.append('should_randomize', shouldRandomize.toString());

                const resp = await fetch(`/api/upload-chunk?token=${token}`, {
                    method: 'POST',
                    body: formData,
                });
                if (!resp.ok) throw new Error(`Chunk ${i} failed: ${resp.status}`);

                setProgress(Math.round(((i + 1) / totalChunks) * 100));
            }
        } catch (err) {
            console.error('[Upload] Failed:', err);
            setUploading(false);
            return;
        }

        setUploading(false);
        onUploadComplete();
        onClose();
    };


    const encOptions: { level: 0 | 1 | 2; label: string; hint: string; icon: string; disabled?: boolean }[] = [
        {
            level: 0,
            label: 'No Encryption',
            hint: 'Stored as plaintext — any vault user can access',
            icon: '🔓',
        },
        {
            level: 1,
            label: 'Vault Key',
            hint: 'Encrypted with the vault master key — any authenticated user',
            icon: '🔒',
        },
        {
            level: 2,
            label: 'Personal Key',
            hint: hasUserKey
                ? 'Double-encrypted with your personal key — only you can view it'
                : 'Login with a Personal Key to enable this option',
            icon: '🔐',
            disabled: !hasUserKey,
        },
    ];

    return (
        <div id="upload-modal" className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-card">
                <button className="modal-close" onClick={onClose}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <h3>Secure Upload</h3>
                <p className="modal-sub">Files are encrypted server-side before storage</p>

                {!uploading ? (
                    <>
                        {/* Drop zone */}
                        <label
                            htmlFor="file-input"
                            id="drop-zone"
                            className={`drop-zone ${dragOver ? 'drag-active' : ''}`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                        >
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                            <span className="drop-label">{file ? file.name : 'Tap or drop a file here'}</span>
                            {file && (
                                <span className="drop-meta">
                                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                                    {isAudio && <span className="audio-note"> · Audio is always stored plaintext for streaming</span>}
                                </span>
                            )}
                        </label>
                        <input type="file" id="file-input" className="hidden" onChange={handleFileChange} />

                        {/* Encryption level selector */}
                        <div className="upload-options">
                            <p className="option-section-label">Encryption Level</p>
                            <div className="enc-level-group">
                                {encOptions.map((opt) => (
                                    <label
                                        key={opt.level}
                                        className={`enc-level-option ${encLevel === opt.level && !isAudio ? 'selected' : ''} ${opt.disabled || isAudio ? 'disabled' : ''}`}
                                        title={opt.disabled ? 'Login with a Personal Key to enable this' : opt.hint}
                                    >
                                        <input
                                            type="radio"
                                            name="enc_level"
                                            value={opt.level}
                                            checked={!isAudio && encLevel === opt.level}
                                            disabled={!!opt.disabled || isAudio}
                                            onChange={() => !opt.disabled && !isAudio && setEncLevel(opt.level)}
                                        />
                                        <span className="enc-level-icon">{opt.icon}</span>
                                        <span className="enc-level-text">
                                            <span className="enc-level-name">{opt.label}</span>
                                            <span className="enc-level-hint">{isAudio && opt.level !== 0 ? 'N/A for audio' : opt.hint}</span>
                                        </span>
                                        {opt.level === 2 && !hasUserKey && (
                                            <span className="enc-level-lock">🔑</span>
                                        )}
                                    </label>
                                ))}
                            </div>

                            {/* Randomize name */}
                            <label className="checkbox-container" style={{ marginTop: '0.75rem' }}>
                                <input
                                    type="checkbox"
                                    checked={shouldRandomize}
                                    onChange={(e) => setShouldRandomize(e.target.checked)}
                                />
                                <span className="checkmark"></span>
                                <div className="option-text">
                                    <span className="option-label">Randomize Filename</span>
                                    <span className="option-hint">Shadow-identity masking</span>
                                </div>
                            </label>
                        </div>

                        <div className="modal-actions">
                            <button className="btn-primary" disabled={!file} onClick={handleUpload}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg>
                                Upload File
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="upload-progress">
                        <div className="ring-wrap" style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto' }}>
                            <svg className="ring" viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
                                <circle className="ring-bg" cx="40" cy="40" r="34" fill="none" stroke="var(--bg3)" strokeWidth="4" />
                                <circle
                                    className="ring-fill"
                                    cx="40" cy="40" r="34"
                                    fill="none" stroke="var(--accent)" strokeWidth="4"
                                    strokeDasharray="213.6"
                                    strokeDashoffset={213.6 - (213.6 * progress) / 100}
                                    style={{ transition: 'stroke-dashoffset 0.3s' }}
                                />
                            </svg>
                            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                {progress}%
                            </span>
                        </div>
                        <div className="upload-stats" style={{ marginTop: '1rem' }}>
                            <span className="upload-fname" title={file?.name}>{file?.name}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UploadModal;
