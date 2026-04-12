/**
 * events.ts
 * 
 * Server-Sent Events (SSE) Manager.
 * Allows pushing real-time updates (like conversion completion) to the frontend.
 */

import { Response } from 'express';

interface SSEClient {
    id: string;
    res: Response;
}

class EventManager {
    private clients: SSEClient[] = [];

    /**
     * Registers a new SSE client
     */
    addClient(res: Response): string {
        const id = Math.random().toString(36).substring(2, 9);
        
        // SSE Headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Send initial connection message
        res.write('data: {"type":"connected"}\n\n');

        this.clients.push({ id, res });
        console.log(`[SSE] Client connected (${id}). Total: ${this.clients.length}`);

        return id;
    }

    /**
     * Removes a client by ID
     */
    removeClient(id: string) {
        this.clients = this.clients.filter(c => c.id !== id);
        console.log(`[SSE] Client disconnected (${id}). Remaining: ${this.clients.length}`);
    }

    /**
     * Broadcasts a message to all connected clients
     */
    emit(event: string, data: any) {
        const payload = JSON.stringify({ type: event, ...data });
        this.clients.forEach(client => {
            client.res.write(`data: ${payload}\n\n`);
        });
    }
}

export const eventManager = new EventManager();
