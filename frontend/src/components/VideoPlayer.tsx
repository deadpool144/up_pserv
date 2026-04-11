import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';

interface VideoPlayerProps {
    fileSize: number;
    fileId: string;
    token: string;
    onClose?: () => void;
    isIdle?: boolean;
    onNext?: () => void;
    onPrev?: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ fileId, token, isIdle = false, onNext, onPrev }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverX, setHoverX] = useState(0);

    const controlsTimeoutRef = useRef<any>(null);

    const hlsUrl = `/api/stream/${fileId}/v.m3u8?token=${token}`;

    useEffect(() => {
        if (!videoRef.current) return;
        const video = videoRef.current;

        if (Hls.isSupported()) {
            const hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: false, // 🔥 Prioritize stability for mobile
                backBufferLength: 90,
                maxBufferLength: 180,  // 🔥 3 minute buffer
                maxMaxBufferLength: 600,
                maxBufferSize: 250 * 1000 * 1000, // 250MB cap
                nudgeMaxRetry: 5,
                // These help with fragmented MP4 streaming over poor connections
                fragLoadingMaxRetry: 10,
                manifestLoadingMaxRetry: 10,
                levelLoadingMaxRetry: 10
            });
            
            hlsRef.current = hls;
            hls.loadSource(hlsUrl);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                setIsLoading(false);
                video.play().catch(() => { /* Autoplay block */ });
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    switch (data.details) {
                        case Hls.ErrorDetails.FRAG_LOAD_ERROR:
                        case Hls.ErrorDetails.FRAG_LOAD_TIMEOUT:
                        case Hls.ErrorDetails.LEVEL_LOAD_ERROR:
                            console.warn("HLS: Fragment load error, retrying...", data.details);
                            hls.startLoad();
                            break;
                        case Hls.ErrorDetails.BUFFER_APPEND_ERROR:
                        case Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR:
                            console.error("HLS: Buffer error, recovering...", data.details);
                            hls.recoverMediaError();
                            break;
                        default:
                            console.error("HLS: Fatal error", data.details);
                            setError("Stream failed. Try Standard Mode?");
                            hls.destroy();
                            break;
                    }
                }
            });
        } 
        else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS support
            video.src = hlsUrl;
            video.addEventListener('loadedmetadata', () => setIsLoading(false));
        }
        else {
            setError("HLS is not supported in this browser.");
            video.src = `/api/preview/${fileId}?token=${token}`;
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [fileId, token]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play().catch(console.error);
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const skip = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    const formatTime = (time: number) => {
        const m = Math.floor(time / 60);
        const s = Math.floor(time % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 3000);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
            else if (e.code === 'ArrowRight') skip(10);
            else if (e.code === 'ArrowLeft') skip(-10);
            else if (e.code === 'KeyF') toggleFullscreen();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPlaying]);

    return (
        <div 
            ref={containerRef}
            className={`custom-player ${showControls && !isIdle ? 'show-controls' : 'hide-controls'} ${isFullscreen ? 'is-fullscreen' : ''}`}
            onMouseMove={handleMouseMove}
            onClick={(e) => e.stopPropagation()}
        >
            {isLoading && !error && (
                <div className="player-loader">
                    <div className="loader-spinner"></div>
                    <span>Initializing Secure Stream...</span>
                </div>
            )}

            {error && (
                <div className="player-loader player-error">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                    <span>{error}</span>
                    <div className="error-actions">
                        <button onClick={() => {
                            setError(null);
                            setIsLoading(true);
                            if (videoRef.current) videoRef.current.src = `/api/preview/${fileId}?token=${token}`;
                        }}>Standard Mode</button>
                        <button onClick={() => window.location.reload()}>Retry HLS</button>
                    </div>
                </div>
            )}

            <video
                ref={videoRef}
                className="main-video"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onClick={togglePlay}
                autoPlay
                controls={false}
                playsInline
            />

            <div className="player-ui">
                {onPrev && (
                    <button className="nav-arrow prev-arrow" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                )}
                {onNext && (
                    <button className="nav-arrow next-arrow" onClick={(e) => { e.stopPropagation(); onNext(); }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                )}
                <div className="center-controls" onClick={togglePlay}>
                    {!isPlaying && !isLoading && !error && (
                        <div className="big-play-btn">
                            <svg width="60" height="60" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                    )}
                </div>

                <div className="bottom-bar">
                    <div className="seek-container">
                        <input
                            type="range"
                            min="0"
                            max={duration || 0}
                            step="0.1"
                            value={currentTime}
                            onChange={handleSeek}
                            onMouseMove={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                const percent = x / rect.width;
                                setHoverTime(percent * duration);
                                setHoverX(x);
                            }}
                            onMouseLeave={() => setHoverTime(null)}
                            className="seek-bar"
                        />
                        <div className="progress-fill" style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}></div>
                        {hoverTime !== null && (
                            <div className="seek-tooltip" style={{ left: `${hoverX}px` }}>
                                {formatTime(hoverTime)}
                            </div>
                        )}
                    </div>

                    <div className="controls-row">
                        <div className="controls-left">
                            <button className="ctrl-btn" onClick={togglePlay}>
                                {isPlaying ? (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                                ) : (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                )}
                            </button>
                            
                            <button className="ctrl-btn" onClick={() => skip(-10)} title="Backward 10s">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
                            </button>
                            
                            <button className="ctrl-btn" onClick={() => skip(10)} title="Forward 10s">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
                            </button>

                            <div className="time-display">
                                <span>{formatTime(currentTime)}</span>
                                <span className="time-sep">/</span>
                                <span>{formatTime(duration)}</span>
                            </div>

                            <span className="hls-badge">HLS Mode</span>
                        </div>

                        <div className="controls-right">
                            <div className="volume-container">
                                <button className="ctrl-btn" onClick={() => {
                                    if (videoRef.current) {
                                        const newMuted = !isMuted;
                                        videoRef.current.muted = newMuted;
                                        setIsMuted(newMuted);
                                    }
                                }}>
                                    {isMuted || volume === 0 ? (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>
                                    ) : (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                                    )}
                                </button>
                                <input 
                                    type="range" 
                                    className="volume-slider" 
                                    min="0" max="1" step="0.1" 
                                    value={isMuted ? 0 : volume}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setVolume(val);
                                        if (videoRef.current) {
                                            videoRef.current.volume = val;
                                            videoRef.current.muted = val === 0;
                                            setIsMuted(val === 0);
                                        }
                                    }}
                                />
                            </div>

                            <button className="ctrl-btn" onClick={toggleFullscreen}>
                                {isFullscreen ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoPlayer;
