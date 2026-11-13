// public/js/player.js
let hlsInstance = null;
let dashInstance = null;
let currentStreamConfig = null;

export function destroyPlayer() {
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  if (dashInstance) { dashInstance.reset(); dashInstance = null; }
  const video = document.getElementById("koraVideo");
  if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
}

export function initVideoPlayer(streamData) {
  currentStreamConfig = streamData;
  destroyPlayer();

  const video = document.getElementById("koraVideo");
  const qualitySelect = document.getElementById("qualitySelect");
  const statusBadge = document.getElementById("streamStatusBadge");
  qualitySelect.innerHTML = `<option value="-1">تلقائي (Auto)</option>`;

  const url = streamData.streamUrl;
  const type = (streamData.streamType || "HLS").toUpperCase();

  if (type === "HLS" && window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);

    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, (_, data) => {
      statusBadge.textContent = "البث يعمل (HLS)";
      data.levels.forEach((lvl, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${lvl.height || "SD"}p`;
        qualitySelect.appendChild(opt);
      });
      video.play().catch(() => {});
    });

    qualitySelect.onchange = () => {
      if (hlsInstance) hlsInstance.currentLevel = Number(qualitySelect.value);
    };

    hlsInstance.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        statusBadge.textContent = "انقطع الاتصال - جاري إعادة المحاولة...";
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hlsInstance.startLoad();
        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hlsInstance.recoverMediaError();
      }
    });
  } else if (type === "DASH" && window.dashjs) {
    dashInstance = window.dashjs.MediaPlayer().create();
    dashInstance.initialize(video, url, true);
    statusBadge.textContent = "البث يعمل (DASH)";
  } else {
    // MP4 أو Safari Native HLS
    video.src = url;
    statusBadge.textContent = "البث يعمل";
    video.play().catch(() => {});
  }
}

window.retryStream = () => {
  if (currentStreamConfig) initVideoPlayer(currentStreamConfig);
};
