import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

export const config = {
  root,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3200),
  dataDir: path.resolve(root, process.env.DATA_DIR || 'data'),
  skillFile: path.resolve(root, process.env.SKILL_FILE || 'skill/SKILL.md'),

  claudeBin: process.env.CLAUDE_BIN || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || '',

  gflowBin: process.env.GFLOW_BIN || '/home/taki/Downloads/gflow-cli/.venv/bin/gflow',
  gflowProfile: process.env.GFLOW_PROFILE || '',
  gflowModel: process.env.GFLOW_MODEL || 'veo-lite',
  gflowModels: ['veo-lite', 'veo-fast', 'veo-quality', 'omni-flash', 'veo-lite-lp'],

  ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN || 'ffprobe',

  fbPageId: process.env.FB_PAGE_ID || '',
  fbPageToken: process.env.FB_PAGE_TOKEN || '',
  fbGraphVersion: process.env.FB_GRAPH_VERSION || 'v23.0',
};
