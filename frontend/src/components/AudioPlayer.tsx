import React, { useRef, useState, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
    fileId: string;
    fileName: string;
    token: string;
    onNext?: () => void;
    onPrev?: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ fileId, fileName, token, onNext, onPrev }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [seeking, setSeeking] = useState(false);

    const audioUrl = `/api/preview/${fileId}?token=${token}`;
    const thumbUrl = `/api/thumbnail/${fileId}?token=${token}`;

    const formatTime = (time: number) => {
        if (!isFinite(time) || isNaN(time)) return '0:00';
        const mins = Math.floor(time / 60);
        const secs = Math.floor(time % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Sync audio events → state
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onPlay = () => { setIsPlaying(true); setError(null); };
        const onPause = () => setIsPlaying(false);
        const onEnded = () => { setIsPlaying(false); if (onNext) onNext(); };
        const onTimeUpdate = () => { if (!seeking) setCurrentTime(audio.currentTime); };
        const onDurationChange = () => { if (isFinite(audio.duration)) setDuration(audio.duration); };
        const onWaiting = () => setIsLoading(true);
        const onCanPlay = () => { setIsLoading(false); setError(null); };
        const onError = () => {
            const code = audio.error?.code;
            const msgs: Record<number, string> = {
                1: 'Playback aborted.',
                2: 'Network error during load.',
                3: 'Audio decode failed.',
                4: 'Audio format not supported.',
            };
            setError(msgs[code ?? 0] || 'Playback failed. Try downloading the file.');
            setIsLoading(false);
            setIsPlaying(false);
        };

        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('durationchange', onDurationChange);
        audio.addEventListener('waiting', onWaiting);
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('error', onError);

        // Media session
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: fileName,
                artist: 'SecurVault',
                artwork: [{ src: thumbUrl, sizes: '512x512', type: 'image/jpeg' }],
            });
            navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));
            navigator.mediaSession.setActionHandler('pause', () => audio.pause());
            if (onNext) navigator.mediaSession.setActionHandler('nexttrack', onNext);
            if (onPrev) navigator.mediaSession.setActionHandler('previoustrack', onPrev);
        }

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('durationchange', onDurationChange);
            audio.removeEventListener('waiting', onWaiting);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            if ('mediaSession' in navigator) {
                navigator.mediaSession.setActionHandler('play', null);
                navigator.mediaSession.setActionHandler('pause', null);
                navigator.mediaSession.setActionHandler('nexttrack', null);
                navigator.mediaSession.setActionHandler('previoustrack', null);
            }
        };
    }, [fileId, fileName, token, onNext, onPrev, seeking]);

    const togglePlay = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(() => setError('Autoplay blocked. Tap Play to start.'));
        }
    }, [isPlaying]);

    const handleSeekStart = () => setSeeking(true);
    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCurrentTime(parseFloat(e.target.value));
    };
    const handleSeekEnd = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement> | any) => {
        const val = parseFloat(e.currentTarget.value);
        if (audioRef.current) audioRef.current.currentTime = val;
        setSeeking(false);
    };

    const skip = (seconds: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setVolume(v);
        setIsMuted(v === 0);
        if (audioRef.current) { audioRef.current.volume = v; audioRef.current.muted = v === 0; }
    };

    const toggleMute = () => {
        if (audioRef.current) {
            const newMuted = !isMuted;
            audioRef.current.muted = newMuted;
            setIsMuted(newMuted);
        }
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="audio-player-container">

            {/* Album art */}
            <div className={`audio-visual-box ${isPlaying ? 'playing' : ''}`} onClick={togglePlay}>
                <img
                    src={thumbUrl}
                    alt="Album Art"
                    className="audio-cover-art"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
                {/* Animated overlay when playing */}
                {isPlaying && !isLoading && (
                    <div className="audio-eq-overlay">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="audio-eq-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                        ))}
                    </div>
                )}
                {isLoading && (
                    <div className="audio-loading-overlay">
                        <div className="loader-mini"></div>
                    </div>
                )}
                {error && (
                    <div className="audio-error-overlay">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                        <span>{error}</span>
                    </div>
                )}
                {/* Play/pause big center button */}
                {!isPlaying && !isLoading && !error && (
                    <div className="audio-center-play">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="audio-controls-main">
                <div className="audio-info-text">
                    <h3 className="audio-title" title={fileName}>{fileName}</h3>
                </div>

                {/* Seek bar */}
                <div className="audio-progress-row">
                    <span className="time-text">{formatTime(currentTime)}</span>
                    <div className="seekbar-wrapper">
                        <div className="seekbar-track">
                            <div className="seekbar-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <input
                            type="range"
                            className="audio-seekbar"
                            min="0"
                            max={duration || 0}
                            step="0.5"
                            value={currentTime}
                            onMouseDown={handleSeekStart}
                            onTouchStart={handleSeekStart}
                            onChange={handleSeekChange}
                            onMouseUp={handleSeekEnd}
                            onTouchEnd={handleSeekEnd as any}
                        />
                    </div>
                    <span className="time-text">{formatTime(duration)}</span>
                </div>

                {/* Buttons row */}
                <div className="audio-buttons-row">
                    {/* Skip back */}
                    <button className="icon-btn-sm" onClick={() => skip(-10)} title="-10s">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/>
                        </svg>
                    </button>

                    {/* Prev */}
                    <button className="icon-btn-sm" onClick={onPrev} title="Previous" disabled={!onPrev}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" /></svg>
                    </button>

                    {/* Play / Pause */}
                    <button className="audio-main-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
                        {isPlaying ? (
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                        ) : (
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        )}
                    </button>

                    {/* Next */}
                    <button className="icon-btn-sm" onClick={onNext} title="Next" disabled={!onNext}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" /></svg>
                    </button>

                    {/* Skip forward */}
                    <button className="icon-btn-sm" onClick={() => skip(10)} title="+10s">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/>
                        </svg>
                    </button>
                </div>

                {/* Volume */}
                <div className="audio-volume-group">
                    <button className="icon-btn-sm" style={{ width: 36, height: 36 }} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                        {isMuted || volume === 0 ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                        )}
                    </button>
                    <input
                        type="range"
                        className="audio-vol-bar"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                    />
                </div>
            </div>

            {/* Hidden audio element — no crossOrigin to avoid CORS preflight issues */}
            <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={() => { if (!seeking && audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
                onLoadedMetadata={() => { if (audioRef.current && isFinite(audioRef.current.duration)) setDuration(audioRef.current.duration); }}
                preload="metadata"
                autoPlay
            />
        </div>
    );
};

export default AudioPlayer;
