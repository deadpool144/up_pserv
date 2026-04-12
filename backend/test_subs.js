
import { getSubtitleTracks } from './src/media.js';
import path from 'path';

async function test() {
    const videoPath = 'C:\\Users\\Lenovo\\Desktop\\new_pc_serv\\p_serv\\vault\\videos\\ul_1775929364730_a05h\\data'; // This might be encrypted!
    // Wait, getSubtitleTracks expects a plaintext file usually during queue.
    // I will try to find a plaintext one or use ffprobe directly.
}
test();
