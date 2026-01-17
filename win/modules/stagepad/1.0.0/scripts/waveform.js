import { state } from "./state.js";
import { dom } from "./dom.js";
import { baseName, formatTime } from "./utils.js";

export function findTrackById(trackId) {
  for (const btn of state.scene.buttons) {
    const track = btn.tracks?.find((t) => t.id === trackId);
    if (track) return { btn, track };
  }
  return null;
}

export function resolveSegment(track, durationSeconds) {
  const safeDuration = isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const segment = track?.segment || {};
  const start = Math.max(0, Number(segment.start) || 0);
  const end =
    Number(segment.end) && Number(segment.end) > start && Number(segment.end) <= safeDuration
      ? Number(segment.end)
      : safeDuration || Number(segment.end) || 0;
  return {
    start,
    end: end || safeDuration,
    loop: Boolean(segment.loop),
    reverse: Boolean(segment.reverse),
  };
}

async function ensureAudioContext() {
  if (state.waveAudioCtx) return state.waveAudioCtx;
  state.waveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return state.waveAudioCtx;
}

function buildPeaks(buffer, width) {
  const channelData = buffer.getChannelData(0);
  const sampleCount = channelData.length;
  const buckets = Math.max(10, Math.floor(width));
  const samplesPerBucket = Math.max(1, Math.floor(sampleCount / buckets));
  const peaks = [];
  for (let i = 0; i < buckets; i += 1) {
    const start = i * samplesPerBucket;
    const end = Math.min(sampleCount, start + samplesPerBucket);
    let min = 1;
    let max = -1;
    for (let j = start; j < end; j += 1) {
      const sample = channelData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks.push({ min, max });
  }
  return peaks;
}

export async function getTrackBuffer(track) {
  if (!track?.file || !state.currentProject) throw new Error("Файл трека не найден");
  if (state.waveBuffers.has(track.id)) return state.waveBuffers.get(track.id);
  const ctx = await ensureAudioContext();
  const fileUrl = window.stagepadAPI.getAssetFileUrl(state.currentProject.id, track.file);
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const peaks = buildPeaks(
    audioBuffer,
    (dom.waveCanvas?.clientWidth || dom.waveCanvas?.width || 1200) * 2
  );
  const entry = { buffer: audioBuffer, peaks, duration: audioBuffer.duration };
  state.waveBuffers.set(track.id, entry);
  return entry;
}

const buildReversedBuffer = (buffer, startSec, endSec) => {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(buffer.length, Math.floor(endSec * sampleRate));
  const length = Math.max(1, endSample - startSample);
  const channels = buffer.numberOfChannels;
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  for (let ch = 0; ch < channels; ch += 1) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      dst[i] = src[endSample - 1 - i];
    }
  }
  return out;
};

const audioBufferToWav = (audioBuffer) => {
  const numCh = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const length = audioBuffer.length * numCh * bytesPerSample;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
    offset += str.length;
  };

  const writeUint32 = (value) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };

  const writeUint16 = (value) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };

  writeString("RIFF");
  writeUint32(36 + length);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16);
  writeUint16(format);
  writeUint16(numCh);
  writeUint32(sampleRate);
  writeUint32(sampleRate * numCh * bytesPerSample);
  writeUint16(numCh * bytesPerSample);
  writeUint16(bitDepth);
  writeString("data");
  writeUint32(length);

  offset = 44;
  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let ch = 0; ch < numCh; ch += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return buffer;
};

export async function getReversedSegmentUrl(track, segment) {
  const entry = await getTrackBuffer(track);
  const seg = resolveSegment({ ...track, segment }, entry.duration);
  const length = Math.max(0.01, (seg.end || entry.duration) - seg.start);
  const key = `${track.id}:${seg.start}:${seg.end}:rev`;
  if (state.reverseCache.has(key)) {
    return { url: state.reverseCache.get(key), segment: seg, duration: length };
  }
  const reversedBuffer = buildReversedBuffer(entry.buffer, seg.start, seg.end || entry.duration);
  const wavData = audioBufferToWav(reversedBuffer);
  const blob = new Blob([wavData], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  state.reverseCache.set(key, url);
  return { url, segment: seg, duration: reversedBuffer.duration };
}

export function drawWaveform(track, peaks, durationSec) {
  if (!dom.waveCanvas) return;
  const canvas = dom.waveCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || canvas.width || 1200;
  const height = canvas.height || 160;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  const viewDuration = Math.max(0.1, durationSec / Math.max(1, state.waveZoom));
  const maxPan = Math.max(0, durationSec - viewDuration);
  const viewStart = Math.max(0, Math.min(state.wavePan, maxPan));
  const viewEnd = Math.min(durationSec, viewStart + viewDuration);

  const half = height / 2;
  ctx.strokeStyle = "rgba(0, 200, 255, 0.7)";
  ctx.beginPath();
  const startIdx = Math.floor((viewStart / durationSec) * peaks.length);
  const endIdx = Math.ceil((viewEnd / durationSec) * peaks.length);
  const visiblePeaks = peaks.slice(Math.max(0, startIdx - 1), Math.min(peaks.length, endIdx + 1));
  const bucketWidth = width / Math.max(1, visiblePeaks.length);
  visiblePeaks.forEach((peak, idx) => {
    const x = idx * bucketWidth;
    const yTop = half - peak.max * half;
    const yBottom = half - peak.min * half;
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
  });
  ctx.stroke();

  const seg = resolveSegment(track, durationSec);
  if (seg.end > seg.start) {
    const startX = ((seg.start - viewStart) / (viewDuration || 1)) * width;
    const endX = ((seg.end - viewStart) / (viewDuration || 1)) * width;
    ctx.fillStyle = "rgba(255,200,80,0.2)";
    ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);
    ctx.strokeStyle = "rgba(255,200,80,0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, 0, Math.max(1, endX - startX), height);
    const handleWidth = 6;
    const handleHeight = height;
    ctx.fillStyle = "rgba(255,200,80,0.85)";
    ctx.fillRect(startX - handleWidth / 2, 0, handleWidth, handleHeight);
    ctx.fillRect(endX - handleWidth / 2, 0, handleWidth, handleHeight);
  }
  if (dom.waveSelectionInfo) {
    dom.waveSelectionInfo.textContent = `Старт: ${formatTime(seg.start)} · Конец: ${formatTime(
      seg.end || durationSec
    )} · Длина: ${formatTime(Math.max(0, (seg.end || durationSec) - seg.start))}`;
  }
  if (dom.waveTrackDuration) {
    dom.waveTrackDuration.textContent = formatTime(durationSec);
  }

  if (state.waveStartMarker != null) {
    const startX = ((state.waveStartMarker - viewStart) / (viewDuration || 1)) * width;
    if (startX >= 0 && startX <= width) {
      ctx.strokeStyle = "rgba(200,200,200,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.stroke();
    }
  }

  if (state.waveMarkerTime != null) {
    const markerX = ((state.waveMarkerTime - viewStart) / (viewDuration || 1)) * width;
    if (markerX >= 0 && markerX <= width) {
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(markerX, 0);
      ctx.lineTo(markerX, height);
      ctx.stroke();
    }
  }
}

export async function showWaveform(trackId) {
  const found = findTrackById(trackId);
  if (!found) {
    if (dom.waveSelectionInfo) dom.waveSelectionInfo.textContent = "Трек не найден";
    return;
  }
  const { track, btn } = found;
  try {
    const entry = await getTrackBuffer(track);
    state.currentWaveTrackId = track.id;
    state.waveDuration = entry.duration;
    state.waveStartMarker = null;
    if (dom.waveButtonLabel) dom.waveButtonLabel.textContent = btn.label || "Кнопка";
    if (dom.waveTrackLabel) dom.waveTrackLabel.textContent = baseName(track.label || track.file || "Трек");
    if (dom.waveTrackNameInput) dom.waveTrackNameInput.value = track.label || baseName(track.file || "Трек");
    if (dom.waveNameView) dom.waveNameView.hidden = false;
    if (dom.waveNameEdit) dom.waveNameEdit.hidden = true;
    if (dom.waveNameStack) dom.waveNameStack.classList.remove("editing");
    const seg = resolveSegment(track, entry.duration);
    if (dom.waveLoopToggle) dom.waveLoopToggle.checked = Boolean(track.segment?.loop);
    if (dom.waveReverseToggle) dom.waveReverseToggle.checked = Boolean(track.segment?.reverse);
    drawWaveform(track, entry.peaks, entry.duration);
    if (dom.wavePopover) dom.wavePopover.hidden = false;
  } catch (error) {
    console.error(error);
    if (dom.waveSelectionInfo) dom.waveSelectionInfo.textContent = error?.message || "Не удалось загрузить трек";
  }
}

export function updateTrackSegment(trackId, segment) {
  const found = findTrackById(trackId);
  if (!found) return;
  const { track } = found;
  track.segment = {
    start: Math.max(0, segment.start || 0),
    end: Math.max(segment.start || 0, segment.end || 0),
    loop: Boolean(segment.loop),
    reverse: Boolean(segment.reverse),
  };
}

export function timeFromClientX(clientX) {
  const rect = dom.waveCanvas.getBoundingClientRect();
  const ratio = (clientX - rect.left) / rect.width;
  const viewDuration = Math.max(0.1, state.waveDuration / Math.max(1, state.waveZoom));
  const maxPan = Math.max(0, state.waveDuration - viewDuration);
  const viewStart = Math.max(0, Math.min(state.wavePan, maxPan));
  return viewStart + Math.max(0, Math.min(1, ratio)) * viewDuration;
}

export function startWaveInteraction(clientX) {
  if (!state.currentWaveTrackId || !dom.waveCanvas || !state.waveDuration) return;
  const found = findTrackById(state.currentWaveTrackId);
  if (!found) return;
  const { track } = found;
  const seg = resolveSegment(track, state.waveDuration);
  const time = timeFromClientX(clientX);
  const snapped = time;
  const rect = dom.waveCanvas.getBoundingClientRect();
  const width = rect.width;
  const viewDuration = Math.max(0.1, state.waveDuration / Math.max(1, state.waveZoom));
  const maxPan = Math.max(0, state.waveDuration - viewDuration);
  const viewStart = Math.max(0, Math.min(state.wavePan, maxPan));
  const handlePx = 12;
  const startX = rect.left + ((seg.start - viewStart) / viewDuration) * width;
  const endX = rect.left + ((seg.end - viewStart) / viewDuration) * width;
  if (Math.abs(clientX - startX) <= handlePx) {
    state.waveSelectionMode = "resize-start";
    state.waveEdgeOffset = snapped - seg.start;
  } else if (Math.abs(clientX - endX) <= handlePx) {
    state.waveSelectionMode = "resize-end";
    state.waveEdgeOffset = snapped - seg.end;
  } else if (clientX < startX) {
    state.waveSelectionMode = "resize-start";
    state.waveEdgeOffset = 0;
  } else if (clientX > endX) {
    state.waveSelectionMode = "resize-end";
    state.waveEdgeOffset = 0;
  } else if (snapped >= seg.start && snapped <= seg.end) {
    state.waveSelectionMode = "move";
  } else {
    state.waveSelectionMode = "resize-end";
    state.waveEdgeOffset = 0;
  }
  state.waveLastTime = snapped;
}

export function continueWaveInteraction(clientX) {
  if (!state.currentWaveTrackId || !dom.waveCanvas || !state.waveDuration || !state.waveSelectionMode) return;
  const found = findTrackById(state.currentWaveTrackId);
  if (!found) return;
  const { track } = found;
  const time = timeFromClientX(clientX);
  const seg = resolveSegment(track, state.waveDuration);
  let start = seg.start;
  let end = seg.end || state.waveDuration;
  const minLen = 0.05;
  if (state.waveSelectionMode === "resize-start") {
    start = Math.min(time - state.waveEdgeOffset, end - minLen);
  } else if (state.waveSelectionMode === "resize-end") {
    end = Math.max(time - state.waveEdgeOffset, start + minLen);
  } else if (state.waveSelectionMode === "move") {
    if (state.waveLastTime == null) state.waveLastTime = time;
    const delta = time - state.waveLastTime;
    const length = end - start;
    start = Math.max(0, Math.min(state.waveDuration - length, start + delta));
    end = start + length;
    state.waveLastTime = time;
  }
  start = Math.max(0, Math.min(start, state.waveDuration - minLen));
  end = Math.max(start + minLen, Math.min(end, state.waveDuration));
  updateTrackSegment(track.id, {
    start,
    end,
    loop: dom.waveLoopToggle?.checked,
    reverse: dom.waveReverseToggle?.checked,
  });
  if (state.wavePreviewAudio && state.currentWaveTrackId === track.id) {
    if (seg.reverse) {
      const len = Math.max(0.01, end - start);
      state.wavePreviewAudio.currentTime = Math.max(0, Math.min(len, state.wavePreviewAudio.currentTime));
    } else if (state.wavePreviewAudio.currentTime < start || state.wavePreviewAudio.currentTime > end) {
      state.wavePreviewAudio.currentTime = start;
    }
    if (state.waveMarkerRaf) cancelAnimationFrame(state.waveMarkerRaf);
    const redrawMarker = () => {
      if (!state.wavePreviewAudio) return;
      const totalEnd = end || state.waveDuration || track?.duration || 0;
      state.waveMarkerTime = seg.reverse
        ? Math.max(0, totalEnd - Math.min(totalEnd - start, state.wavePreviewAudio.currentTime))
        : state.wavePreviewAudio.currentTime;
      drawWaveform(track, state.waveBuffers.get(track.id)?.peaks || [], state.waveDuration);
      state.waveMarkerRaf = requestAnimationFrame(redrawMarker);
    };
    state.waveMarkerRaf = requestAnimationFrame(redrawMarker);
  }
  drawWaveform(track, state.waveBuffers.get(track.id)?.peaks || [], state.waveDuration);
}

export function stopWaveInteraction() {
  state.waveSelectionMode = null;
  state.waveLastTime = null;
}

export function stopWavePreview() {
  if (state.wavePreviewAudio) {
    state.wavePreviewAudio.pause();
    state.wavePreviewAudio = null;
  }
  state.waveMarkerTime = null;
  if (state.waveMarkerRaf) {
    cancelAnimationFrame(state.waveMarkerRaf);
    state.waveMarkerRaf = null;
  }
  state.wavePreviewTrackId = null;
  if (dom.wavePlayBtn) dom.wavePlayBtn.textContent = "▶ Плей";
}

export async function playWavePreview() {
  if (!state.currentWaveTrackId || !state.currentProject) return;
  const found = findTrackById(state.currentWaveTrackId);
  if (!found) return;
  const { track, btn } = found;
  const entry = state.waveBuffers.get(track.id) || (await getTrackBuffer(track));
  const seg = resolveSegment(track, state.waveDuration || entry?.duration || 0);
  if (state.wavePreviewAudio) {
    if (state.wavePreviewTrackId === track.id) {
      const len = Math.max(0, (seg.end || state.waveDuration || entry?.duration || 0) - (seg.start || 0));
      let startTime =
        state.waveStartMarker != null
          ? state.waveStartMarker
          : seg.reverse
            ? seg.end || state.waveDuration || entry?.duration || 0
            : seg.start || 0;
      if (!seg.reverse && seg.loop && (startTime < seg.start || startTime > seg.end)) startTime = seg.start;
      if (seg.reverse) {
        const target = Math.max(0, Math.min(len, (seg.end || len) - startTime));
        state.wavePreviewAudio.currentTime = target;
      } else {
        state.wavePreviewAudio.currentTime = Math.max(0, Math.min(startTime, entry?.duration || seg.end || 0));
      }
      if (state.wavePreviewAudio.paused) state.wavePreviewAudio.play();
      return;
    }
    stopWavePreview();
  }
  try {
    const previewFile = state.wavePreviewFile || track.file;
    const previewOverride = Boolean(state.wavePreviewFile && state.wavePreviewFile !== track.file);
    let playbackUrl = window.stagepadAPI.getAssetFileUrl(state.currentProject.id, previewFile);
    let reverseMeta = null;
    if (seg.reverse && !previewOverride) {
      const { url, segment } = await getReversedSegmentUrl(track, seg);
      playbackUrl = url;
      reverseMeta = segment;
    }
    const audio = new Audio(playbackUrl);
    if (audio?.setSinkId) {
      const deviceId = localStorage.getItem("stagepadAudioOutputEditor") || "";
      if (deviceId) {
        try {
          await audio.setSinkId(deviceId);
        } catch (error) {
          console.warn("Не удалось применить аудиовыход для предпрослушки:", error);
        }
      }
    }
    const len = Math.max(0, (seg.end || state.waveDuration || entry?.duration || 0) - (seg.start || 0));
    let startTime =
      state.waveStartMarker != null
        ? state.waveStartMarker
        : seg.reverse
          ? seg.end || state.waveDuration || entry?.duration || 0
          : seg.start || 0;
    if (seg.loop && !seg.reverse) {
      if (startTime < seg.start || startTime > seg.end) startTime = seg.start;
    }
    if (reverseMeta) {
      const target = Math.max(0, Math.min(len, (reverseMeta.end || seg.end || len) - startTime));
      audio.currentTime = target;
    } else {
      audio.currentTime = Math.max(0, Math.min(startTime, entry?.duration || seg.end || 0));
    }
    audio.loop = false;
    const updateMarker = () => {
      if (!state.wavePreviewAudio) return;
      const endVal = seg.end || state.waveDuration || entry?.duration || audio.duration;
      state.waveMarkerTime = seg.reverse ? Math.max(0, endVal - audio.currentTime) : audio.currentTime;
      if (state.currentWaveTrackId === track.id) {
        drawWaveform(
          track,
          state.waveBuffers.get(track.id)?.peaks || [],
          state.waveDuration || entry?.duration || audio.duration
        );
      }
      state.waveMarkerRaf = requestAnimationFrame(updateMarker);
    };
    audio.addEventListener("timeupdate", () => {
      const liveSeg = resolveSegment(track, state.waveDuration || audio.duration);
      const effectiveEnd = reverseMeta ? reverseMeta.end || liveSeg.end || audio.duration : liveSeg.end;
      const effectiveStart = reverseMeta ? reverseMeta.start || liveSeg.start || 0 : liveSeg.start;
      const length = Math.max(0, (effectiveEnd || audio.duration) - (effectiveStart || 0));
      if (reverseMeta) {
        if (audio.currentTime >= length - 0.01) {
          if (liveSeg.loop) {
            audio.currentTime = 0;
            if (audio.paused) audio.play();
          } else {
            stopWavePreview();
          }
        }
      } else if (liveSeg.end > liveSeg.start) {
        if (liveSeg.loop) {
          if (audio.currentTime > liveSeg.end || audio.currentTime >= liveSeg.end - 0.01) {
            audio.currentTime = liveSeg.start;
            if (audio.paused) audio.play();
          }
        } else if (audio.currentTime >= liveSeg.end - 0.01) {
          stopWavePreview();
        }
      }
    });
    audio.addEventListener("ended", stopWavePreview);
    audio.addEventListener("play", () => {
      if (state.waveMarkerRaf) cancelAnimationFrame(state.waveMarkerRaf);
      updateMarker();
    });
    audio.addEventListener("pause", () => {
      if (state.waveMarkerRaf) {
        cancelAnimationFrame(state.waveMarkerRaf);
        state.waveMarkerRaf = null;
      }
    });
    state.wavePreviewAudio = audio;
    state.wavePreviewTrackId = track.id;
    if (dom.wavePlayBtn) dom.wavePlayBtn.textContent = "■ Стоп";
    audio.play();
    if (dom.waveSelectionInfo)
      dom.waveSelectionInfo.textContent = `Прослушивание: ${btn.label || "Кнопка"} · ${formatTime(
        seg.start
      )}–${formatTime(seg.end)}`;
  } catch (error) {
    stopWavePreview();
    if (dom.waveSelectionInfo) dom.waveSelectionInfo.textContent = error?.message || "Не удалось воспроизвести сегмент";
  }
}

export function setStartMarker(time, track) {
  const seg = resolveSegment(track, state.waveDuration || track?.duration || 0);
  let t = Math.max(0, Math.min(time, state.waveDuration || seg.end || 0));
  if (seg.loop && t > seg.end) t = seg.start;
  if (seg.loop && t < seg.start) t = seg.start;
  state.waveStartMarker = t;
  state.waveMarkerTime = state.wavePreviewAudio
    ? seg.reverse
      ? seg.end - state.wavePreviewAudio.currentTime
      : state.wavePreviewAudio.currentTime
    : t;
  drawWaveform(track, state.waveBuffers.get(track.id)?.peaks || [], state.waveDuration);
  if (state.wavePreviewAudio && state.currentWaveTrackId === track.id) {
    if (seg.reverse) {
      const target = Math.max(0, Math.min(seg.end - seg.start, seg.end - t));
      state.wavePreviewAudio.currentTime = target;
    } else if (t < seg.start || t > seg.end) {
      state.wavePreviewAudio.currentTime = seg.start;
    } else {
      state.wavePreviewAudio.currentTime = t;
    }
  }
}

export function closeWavePopover() {
  if (dom.wavePopover) dom.wavePopover.hidden = true;
  state.currentWaveTrackId = null;
  state.waveSelectionMode = null;
  state.waveLastTime = null;
  stopWavePreview();
  state.wavePreviewFile = null;
  state.waveStartMarker = null;
  if (dom.waveNormalizeActions) dom.waveNormalizeActions.hidden = true;
  if (dom.waveNormalizeStatus) dom.waveNormalizeStatus.textContent = "";
  if (dom.waveSelectionInfo) dom.waveSelectionInfo.textContent = "Выберите трек и нажмите SEL, чтобы увидеть волну";
  if (dom.waveTrackNameInput) dom.waveTrackNameInput.value = "";
  if (dom.waveNameView) dom.waveNameView.hidden = false;
  if (dom.waveNameEdit) dom.waveNameEdit.hidden = true;
  if (dom.waveNameStack) dom.waveNameStack.classList.remove("editing");
}
