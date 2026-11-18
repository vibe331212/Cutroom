// Flick connection.
// When the Flick app opens Cutroom (inside Flick, or in a tab, with ?from=flick&origin=<Flick's address>), Flick sends over the
// photo or video you just took or picked, and Cutroom opens it. The Export buttons turn into
// "Send to Flick": the finished edit goes back to Flick (to post it) instead of being downloaded.
//
// Only Flick running on this computer (localhost) can do this. When Flick is online, add its
// address to ONLINE_FLICK below, like 'https://flick.example.com'.
const ONLINE_FLICK = ['https://flick-cyan.vercel.app'];

const params = new URLSearchParams(location.search);
const origin = params.get('origin') || '';
const trusted = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin) || ONLINE_FLICK.includes(origin);
// Flick shows Cutroom inside itself (an iframe), or in its own tab. Either way, peer is the Flick window.
const peer = window.parent !== window ? window.parent : window.opener;
const active = params.get('from') === 'flick' && !!peer && trusted;

let toast = msg => console.log(msg);
let banner = null;

function setBanner(text) {
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'flick-banner';
    banner.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;'
      + 'padding:8px 16px;border-radius:999px;background:linear-gradient(135deg,#ff4f7b,#7c5cff);color:#fff;font:600 13px/1.3 -apple-system,Segoe UI,sans-serif;'
      + 'box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:92vw;text-align:center;pointer-events:none';
    document.body.appendChild(banner);
  }
  banner.textContent = text;
}

// Changes the words on a button but keeps its icon.
function relabel(id, text) {
  const b = document.getElementById(id);
  if (!b) return;
  const last = [...b.childNodes].reverse().find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  if (last) last.textContent = text; else b.append(text);
}

export const Flick = {
  active,

  // Called once when Cutroom starts. open(file) puts a photo or video into the editor.
  start({ open, toast: t }) {
    if (!active) return;
    if (t) toast = t;
    setBanner('Connecting to Flick...');
    for (const id of ['btn-export', 'export-go', 'ph-download', 'pe-go']) relabel(id, id === 'ph-download' ? 'Send photo to Flick' : 'Send to Flick');
    addEventListener('message', async e => {
      if (e.source !== peer || e.origin !== origin) return;
      const d = e.data || {};
      if (d.type === 'flick-media' && d.file instanceof Blob) {
        const name = d.file.name || (d.file.type.startsWith('video/') ? 'Flick video.mp4' : 'Flick photo.jpg');
        const file = d.file instanceof File ? d.file : new File([d.file], name, { type: d.file.type });
        setBanner('Editing for Flick. Press Send to Flick when you are done.');
        try { await open(file); } catch (err) { console.error(err); toast("That file couldn't be opened"); }
      }
    });
    peer.postMessage({ type: 'cutroom-ready', version: 1 }, origin);
  },

  // Called by the exports. Returns true when the file went to Flick (so it isn't downloaded).
  deliver(blob, name) {
    if (!active) return false;
    if (!peer || peer.closed) {
      toast('Flick was closed, so your export was downloaded instead');
      return false;
    }
    const file = new File([blob], name, { type: blob.type });
    peer.postMessage({ type: 'cutroom-result', file }, origin);
    setBanner('Sent to Flick. You can go back to Flick now.');
    toast('Sent to Flick');
    return true;
  },
};
