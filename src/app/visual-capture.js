export function captureFilename({ artMode = 'procedural', quality = 'high', mobile = false } = {}) {
  return `verdant-${mobile ? 'mobile' : 'desktop'}-${quality}-${artMode}.webm`;
}

export function supportedVideoMime(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass) return '';
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((mime) => MediaRecorderClass.isTypeSupported?.(mime)) || 'video/webm';
}

/* Capture actual WebGL frames only on measurement URLs. Preserve game rules and timing while recording the scene fixed by performance mode. */
export function captureCanvasVideo(canvas, {
  durationMs = 10000,
  fps = 30,
  MediaRecorderClass = globalThis.MediaRecorder,
} = {}) {
  if (!canvas?.captureStream || !MediaRecorderClass) {
    return Promise.reject(new Error('이 브라우저는 캔버스 녹화를 지원하지 않습니다.'));
  }
  const mimeType = supportedVideoMime(MediaRecorderClass);
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorderClass(stream, {
    mimeType,
    videoBitsPerSecond: 1_800_000,
  });
  return new Promise((resolve, reject) => {
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', (event) => reject(event.error || new Error('녹화 실패')), { once: true });
    recorder.addEventListener('stop', () => {
      for (const track of stream.getTracks()) track.stop();
      resolve(new Blob(chunks, { type: mimeType }));
    }, { once: true });
    recorder.start(250);
    setTimeout(() => recorder.stop(), durationMs);
  });
}
