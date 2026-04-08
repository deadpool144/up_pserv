import React from 'react';
import type { FileData } from './FileCard';
import FileCard from './FileCard';

interface FileGridProps {
    files: FileData[];
    onView: (file: FileData) => void;
    onDelete: (id: string) => void;
    onAddToPlaylist?: (file: FileData) => void;
    token: string;
    viewTitle: string;
}

const FileGrid: React.FC<FileGridProps> = ({ files, onView, onDelete, onAddToPlaylist, token, viewTitle }) => {
    return (
        // No wrapping div — this renders inside <main className="main-content"> in Layout
        <>
            <div className="content-header">
                <div>
                    <h2 id="section-title">{viewTitle}</h2>
                    <div id="file-count" className="file-count">
                        {files.length} {files.length === 1 ? 'item' : 'items'}
                    </div>
                </div>
            </div>

            <div id="grid-container" className="grid">
                {files.length > 0 ? (
                    files.map(file => (
                        <FileCard
                            key={file.id}
                            file={file}
                            onView={onView}
                            onDelete={onDelete}
                            onAddToPlaylist={onAddToPlaylist}
                            token={token}
                        />
                    ))
                ) : (
                    <div className="empty-msg">
                        <div className="empty-icon">🗂️</div>
                        <p>No files found in this category.</p>
                        <span>Upload something to get started.</span>
                    </div>
                )}
            </div>
        </>
    );
};

export default FileGrid;
