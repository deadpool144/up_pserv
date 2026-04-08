import React, { useState, useEffect, useRef } from 'react';
import { pdfjs, Document, Page } from 'react-pdf';

// ── WORKER CONFIGURATION ──────────────────
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

interface PdfViewerProps {
    fileUrl: string;
    fileName: string;
    isIdle: boolean;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName, isIdle }) => {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.0);
    const [loading, setLoading] = useState(true);
    
    const containerRef = useRef<HTMLDivElement>(null);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setLoading(false);
    };

    // ── SCROLL OBSERVER ──────────────────────
    // Tracks which page is currently centered in the viewport
    useEffect(() => {
        if (!containerRef.current || !numPages) return;

        const observerOptions = {
            root: containerRef.current,
            threshold: 0.3, // Page is "active" if 30% visible
        };

        const observerCallback = (entries: IntersectionObserverEntry[]) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const pNum = parseInt(entry.target.getAttribute('data-page-index') || '1');
                    setPageNumber(pNum);
                }
            });
        };

        const observer = new IntersectionObserver(observerCallback, observerOptions);
        
        // Give the DOM a moment to render the pages
        const timeoutId = setTimeout(() => {
            const pages = containerRef.current?.querySelectorAll('.pdf-page-wrapper');
            pages?.forEach((p) => observer.observe(p));
        }, 500);

        return () => {
            observer.disconnect();
            clearTimeout(timeoutId);
        };
    }, [numPages, loading]);

    const scrollToPage = (targetIdx: number) => {
        if (!numPages) return;
        const target = Math.min(Math.max(1, targetIdx), numPages);
        const element = containerRef.current?.querySelector(`[data-page-index="${target}"]`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    const zoom = (delta: number) => {
        setScale(prev => Math.min(Math.max(0.5, prev + delta), 3.0));
    };

    return (
        <div 
            className="pdf-view-wrapper no-copy-no-save" 
            onContextMenu={(e) => e.preventDefault()}
            onCopy={(e) => e.preventDefault()}
            onSelectStart={(e) => e.preventDefault()}
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        >
            <Document
                file={fileUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                className="pdf-document"
                loading={
                    <div className="pdf-state-msg">
                        <div className="loader-mini"></div>
                        <span>Loading Secure PDF...</span>
                    </div>
                }
                error={
                    <div className="pdf-state-msg error">
                        <span>Failed to load PDF. Check your connection or encryption key.</span>
                    </div>
                }
            >
                <div className="pdf-page-container" ref={containerRef}>
                    {numPages && Array.from(new Array(numPages), (el, index) => (
                        <div 
                            key={`page_${index + 1}`} 
                            className="pdf-page-wrapper"
                            data-page-index={index + 1}
                        >
                            <Page 
                                pageNumber={index + 1} 
                                scale={scale} 
                                renderTextLayer={false}
                                renderAnnotationLayer={true}
                                loading={
                                    <div className="page-load-placeholder" style={{ height: 800 * scale }}>
                                        Loading Page {index + 1}...
                                    </div>
                                }
                                className="pdf-canvas-page"
                            />
                        </div>
                    ))}
                </div>
            </Document>

            {!loading && numPages && (
                <div className={`pdf-controls-bar ${isIdle ? 'ui-hidden' : ''}`}>
                    <div className="pdf-nav-group">
                        <button 
                            className="pdf-ctrl-btn" 
                            disabled={pageNumber <= 1} 
                            onClick={() => scrollToPage(pageNumber - 1)}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                        </button>
                        <span className="pdf-page-indicator">
                            {pageNumber} <span className="dim">/</span> {numPages}
                        </span>
                        <button 
                            className="pdf-ctrl-btn" 
                            disabled={pageNumber >= numPages} 
                            onClick={() => scrollToPage(pageNumber + 1)}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                        </button>
                    </div>

                    <div className="pdf-zoom-group">
                        <button className="pdf-ctrl-btn" onClick={() => zoom(-0.2)} title="Zoom Out">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        </button>
                        <span className="scale-text">{Math.round(scale * 100)}%</span>
                        <button className="pdf-ctrl-btn" onClick={() => zoom(0.2)} title="Zoom In">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PdfViewer;
