// "Chrome Facebook" — Chrome riêng để server đăng Reel lên Page qua giao diện Meta Business Suite (như người đăng tay),
// thay cho Graph API. Phần mở/chép profile dùng chung ở chrome-box.js.
import { makeChrome } from './chrome-box.js';

const box = makeChrome({ label: 'Chrome Facebook', dirName: 'fb-chrome', port: Number(process.env.FB_CDP_PORT || 9335) });
export const { CDP_PORT, source, listProfiles, isUp, connect, close, syncProfile, ensure, setWindow } = box;
