import { useDeferredValue, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import jsQR from 'jsqr';
import {
  Camera,
  ChevronRight,
  CheckCircle2,
  LocateFixed,
  MapPin,
  Plus,
  QrCode,
  RefreshCw,
  Store,
  Trash2,
  X,
} from 'lucide-react';

const SEARCH_RADIUS_KM = 0.3;
const PST_PAYLOAD_VERSION = 2;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PST_DRAFT_DB_NAME = 'pst-cleaning-draft-db';
const FEED_CACHE_KEY = 'pst_locations_feed';
const FEED_CACHE_TTL = 60 * 60 * 1000; // 1 час
const PST_DRAFT_STORE_NAME = 'drafts';
const PST_DRAFT_KEY = 'pst-cleaning-form';

const formatDistance = (distanceKm) => {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} м`;
  return `${distanceKm.toFixed(2)} км`;
};

const formatDateTime = (value) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));

const normalizeSearch = (value) =>
  value.toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"'[\]\\+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const capitalizeFirstLetter = (value) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return trimmedValue;
  return trimmedValue.charAt(0).toLocaleUpperCase('ru-RU') + trimmedValue.slice(1);
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const dataUrlToFile = async (dataUrl, fileName, mimeType, lastModified) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: mimeType || blob.type, lastModified });
};

const openDraftDatabase = () =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = window.indexedDB.open(PST_DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PST_DRAFT_STORE_NAME)) {
        database.createObjectStore(PST_DRAFT_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open draft database'));
  });

const loadDraft = async () => {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PST_DRAFT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(PST_DRAFT_STORE_NAME);
    const request = store.get(PST_DRAFT_KEY);
    request.onsuccess = () => { database.close(); resolve(request.result ?? null); };
    request.onerror = () => { database.close(); reject(request.error ?? new Error('Failed to load draft')); };
  });
};

const saveDraft = async (draft) => {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PST_DRAFT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(PST_DRAFT_STORE_NAME);
    store.put(draft);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Failed to save draft')); };
  });
};

const clearDraft = async () => {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PST_DRAFT_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(PST_DRAFT_STORE_NAME);
    store.delete(PST_DRAFT_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Failed to clear draft')); };
  });
};

const draftPhotoToPhotoItem = async (draftPhoto) => {
  const file = await dataUrlToFile(draftPhoto.dataUrl, draftPhoto.name, draftPhoto.type, draftPhoto.lastModified);
  return { id: draftPhoto.id, file, previewUrl: draftPhoto.dataUrl, addedAt: draftPhoto.addedAt };
};

const photoItemToDraftPhoto = async (photo) => ({
  id: photo.id,
  name: photo.file.name,
  type: photo.file.type,
  size: photo.file.size,
  addedAt: photo.addedAt,
  lastModified: photo.file.lastModified,
  dataUrl: await readFileAsDataUrl(photo.file),
});

const loadImage = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load selected image'));
    image.src = dataUrl;
  });

const canvasToJpegBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => { if (!blob) { reject(new Error('Failed to compress image')); return; } resolve(blob); },
      'image/jpeg', quality
    );
  });

const drawFittedStampLine = (context, text, x, y, maxWidth) => {
  const trimmedText = text.trim();
  if (!trimmedText) return;
  if (context.measureText(trimmedText).width <= maxWidth) { context.fillText(trimmedText, x, y); return; }
  let fittedText = trimmedText;
  while (fittedText.length > 4 && context.measureText(`${fittedText}...`).width > maxWidth) {
    fittedText = fittedText.slice(0, -1);
  }
  context.fillText(`${fittedText}...`, x, y);
};

const drawPhotoStamp = (context, canvas, stamp) => {
  const padding = Math.max(18, Math.round(canvas.width * 0.035));
  const lineHeight = Math.max(28, Math.round(canvas.width * 0.038));
  const titleFontSize = Math.max(24, Math.round(canvas.width * 0.036));
  const addressFontSize = Math.max(20, Math.round(canvas.width * 0.03));
  const maxTextWidth = canvas.width - padding * 2;
  const stampHeight = padding * 2 + lineHeight * 3;
  const stampTop = canvas.height - stampHeight;

  const gradient = context.createLinearGradient(0, stampTop, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.24, 'rgba(0,0,0,0.64)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.88)');
  context.fillStyle = gradient;
  context.fillRect(0, stampTop, canvas.width, stampHeight);

  context.textBaseline = 'top';
  context.shadowColor = 'rgba(0,0,0,0.5)';
  context.shadowBlur = 8;
  context.fillStyle = '#ffffff';
  context.font = `800 ${titleFontSize}px Arial, sans-serif`;
  context.fillText(formatDateTime(stamp.submittedAt), padding, stampTop + padding);
  context.font = `600 ${addressFontSize}px Arial, sans-serif`;
  drawFittedStampLine(context, stamp.address, padding, stampTop + padding + lineHeight, maxTextWidth);
  drawFittedStampLine(context, stamp.city, padding, stampTop + padding + lineHeight * 2, maxTextWidth);
  context.shadowBlur = 0;
};

const compressPhoto = async (file, stamp) => {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available for image compression');

  const attempts = [
    { maxSide: 1400, quality: 0.86 },
    { maxSide: 1280, quality: 0.82 },
    { maxSide: 1100, quality: 0.78 },
    { maxSide: 960, quality: 0.72 },
    { maxSide: 820, quality: 0.68 },
  ];

  let bestPhoto = null;
  for (const attempt of attempts) {
    const scale = Math.min(1, attempt.maxSide / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawPhotoStamp(context, canvas, stamp);
    const blob = await canvasToJpegBlob(canvas, attempt.quality);
    const dataUrl = await readFileAsDataUrl(blob);
    const compressedPhoto = {
      fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg',
      mimeType: 'image/jpeg',
      dataUrl,
      sizeBytes: blob.size,
      originalSizeBytes: file.size,
      width: canvas.width,
      height: canvas.height,
    };
    bestPhoto = compressedPhoto;
    if (blob.size <= 800 * 1024) return compressedPhoto;
  }
  return bestPhoto;
};

const formatFileDateTime = (value) => {
  const date = new Date(value);
  const part = (s) => String(s).padStart(2, '0');
  return [date.getFullYear(), part(date.getMonth() + 1), part(date.getDate())].join('-') +
    `_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
};

const sanitizeFileNamePart = (value) =>
  value.normalize('NFKD').replace(/[^\w\d-]+/g, '_').replace(/_+/g, '_')
    .replace(/^_|_$/g, '').slice(0, 48);


const toRadians = (value) => (value * Math.PI) / 180;

const getDistanceKm = (from, to) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const buildSearchIndex = (location) =>
  normalizeSearch([
    location.id, location.city, location.branch, location.address,
    location.category, location.installPlace, location.comment, location.hint,
  ].join(' '));

const chipClass = 'rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]';

const PHOTO_SECTION_LABELS = { before: 'До', after: 'После' };
const PHOTO_SECTION_DESCRIPTIONS = {
  before: 'Снимки состояния до уборки',
  after: 'Снимки состояния после уборки',
};

const getVisualMarkerCoords = (location, locationIndex, locations) => {
  const duplicateIndex = locations.slice(0, locationIndex)
    .filter((item) => item.lat === location.lat && item.lng === location.lng).length;
  const duplicateCount = locations.filter(
    (item) => item.lat === location.lat && item.lng === location.lng
  ).length;
  if (duplicateCount <= 1) return [location.lat, location.lng];
  const angle = (duplicateIndex / duplicateCount) * Math.PI * 2;
  const offset = 0.000035;
  return [location.lat + Math.sin(angle) * offset, location.lng + Math.cos(angle) * offset];
};

const PstMiniMap = ({ coords, locations, selectedLocationId, onSelectLocation }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersGroup = useRef(null);

  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    const L = window.L;

    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false, attributionControl: false, dragging: true, tap: true,
      }).setView([coords.lat, coords.lng], 17);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'OpenStreetMap',
      }).addTo(mapInstance.current);

      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);
      markersGroup.current = L.layerGroup().addTo(mapInstance.current);
    }

    setTimeout(() => { mapInstance.current?.invalidateSize(); }, 100);
    markersGroup.current?.clearLayers();

    L.circle([coords.lat, coords.lng], {
      radius: Math.min(coords.accuracy ?? 35, 90),
      color: '#8fc640', weight: 1, fillColor: '#8fc640', fillOpacity: 0.08, opacity: 0.45,
    }).addTo(markersGroup.current);

    L.circleMarker([coords.lat, coords.lng], {
      radius: 7, color: '#ffffff', weight: 3, fillColor: '#8fc640', fillOpacity: 1,
    }).bindTooltip('Вы здесь', { direction: 'top', offset: [0, -8] }).addTo(markersGroup.current);

    locations.forEach((location, index) => {
      const isSelected = location.id === selectedLocationId;
      const markerCoords = getVisualMarkerCoords(location, index, locations);
      const marker = L.circleMarker(markerCoords, {
        radius: isSelected ? 11 : 8,
        color: isSelected ? '#8fc640' : '#ffffff',
        weight: isSelected ? 4 : 3,
        fillColor: location.installPlace === 'Уличный' ? '#2b6cb0' : '#1a2215',
        fillOpacity: 0.95,
      });
      marker.on('click', () => { onSelectLocation(location.id); });
      marker.bindTooltip(
        `<strong>${escapeHtml(location.hint || location.comment || location.address)}</strong><br>${formatDistance(location.distanceKm)}`,
        { direction: 'top', offset: [0, -10] }
      ).addTo(markersGroup.current);
    });

    const boundsItems = [
      [coords.lat, coords.lng],
      ...locations.map((location, index) => getVisualMarkerCoords(location, index, locations)),
    ];

    if (boundsItems.length > 1) {
      mapInstance.current.fitBounds(window.L.latLngBounds(boundsItems), { padding: [28, 28], maxZoom: 18 });
    } else {
      mapInstance.current.setView([coords.lat, coords.lng], 17);
    }
  }, [coords, locations, onSelectLocation, selectedLocationId]);

  return (
    <div style={{ marginTop: '1.25rem', overflow: 'hidden', borderRadius: 28, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.08)' }}>
      <div ref={mapRef} style={{ height: 280, width: '100%', background: '#eef3e8' }} />
    </div>
  );
};

const InlineCamera = ({ section, onCapture, onClose }) => {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const [camError, setCamError] = useState('')

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
        setReady(true)
      })
      .catch(err => {
        const msg = err.name === 'NotAllowedError'
          ? 'Доступ к камере запрещён. Разрешите доступ к камере в настройках браузера.'
          : 'Камера недоступна на этом устройстве.'
        setCamError(msg)
      })
    return () => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()) }
  }, [])

  const snap = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    canvas.toBlob(blob => {
      if (!blob) return
      const name = `photo_${section}_${Date.now()}.jpg`
      const file = new File([blob], name, { type: 'image/jpeg' })
      onCapture(file)
      setCount(c => c + 1)
    }, 'image/jpeg', 0.88)
  }, [section, onCapture])

  const done = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {flash && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.6, zIndex: 2, pointerEvents: 'none' }} />}
      {camError ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
          <div style={{ color: '#ff6b6b', fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.5 }}>{camError}</div>
          <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Закрыть</button>
        </div>
      ) : (
        <video ref={videoRef} playsInline muted style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {!camError && (
        <div style={{ padding: '20px 24px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#000' }}>
          <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Готово {count > 0 && `(${count} фото)`}
          </button>
          <button onClick={snap} disabled={!ready} style={{ width: 72, height: 72, borderRadius: '50%', background: '#8fc640', border: '4px solid #fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(143,198,64,0.4)', opacity: ready ? 1 : 0.5 }}>
            <Camera size={28} color="#1A1D1E" />
          </button>
          <div style={{ width: 80 }} />
        </div>
      )}
    </div>
  )
}

const PhotoUploadSection = ({ section, photos, onSelect, onRemove, onCameraCapture }) => {
  const [cameraOpen, setCameraOpen] = useState(false)
  return (
  <div className={`rounded-[28px] border border-black/6 bg-[#fbfcf8] p-4 sm:p-5`}>
    {cameraOpen && (
      <InlineCamera
        section={section}
        onCapture={(file) => onCameraCapture(file, section)}
        onClose={() => setCameraOpen(false)}
      />
    )}
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-dark/45">
        {PHOTO_SECTION_LABELS[section]}
      </div>
      <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-brand-dark/45 shadow-sm">
        {photos.length} шт.
      </div>
    </div>

    <button
      type="button"
      onClick={() => setCameraOpen(true)}
      className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-[22px] bg-brand-green px-5 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-brand-dark shadow-[0_18px_35px_rgba(143,198,64,0.24)]"
    >
      <Camera size={18} />
      {section === 'before' ? 'Снять фото до уборки' : 'Снять фото после уборки'}
    </button>

    {photos.length > 0 && (
      <div className="mt-4 space-y-3">
        {photos.map((photo) => (
          <div key={photo.id} className="flex items-center gap-4 rounded-[24px] border border-black/6 bg-white p-3">
            <img src={photo.previewUrl} alt={photo.file.name} className="h-20 w-20 rounded-[18px] object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-brand-dark">{photo.file.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-brand-dark/55">
                <Camera size={13} />
                <span>{formatDateTime(photo.addedAt)}</span>
              </div>
              <div className="mt-1 text-xs text-brand-dark/45">
                {(photo.file.size / (1024 * 1024)).toFixed(2)} МБ
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(photo.id, section)}
              className="rounded-2xl border border-red-100 bg-red-50 p-3 text-red-500 transition hover:bg-red-100"
              aria-label="Удалить фото"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
  )
}

// Дозагрузка фото к уже отправленному отчёту (карточка «Помытые»)
const AddMorePhotosModal = ({ item, onClose, onDone }) => {
  const [beforePhotos, setBeforePhotos] = useState([]);
  const [afterPhotos, setAfterPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    [...beforePhotos, ...afterPhotos].forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCameraCapture = (file, section) => {
    const photo = { id: `${Date.now()}-${Math.random()}`, file, previewUrl: URL.createObjectURL(file), addedAt: new Date().toISOString() };
    if (section === 'before') setBeforePhotos((p) => [...p, photo]);
    else setAfterPhotos((p) => [...p, photo]);
  };
  const removePhoto = (id, section) => {
    if (section === 'before') setBeforePhotos((p) => p.filter((x) => x.id !== id));
    else setAfterPhotos((p) => p.filter((x) => x.id !== id));
  };

  const submit = async () => {
    if (!beforePhotos.length && !afterPhotos.length) return;
    setSubmitting(true); setError('');
    try {
      const stamp = { submittedAt: new Date().toISOString(), address: item.address, city: item.city };
      const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
      const formData = new FormData();
      for (const photo of beforePhotos) {
        const compressed = await compressPhoto(photo.file, stamp);
        formData.append('before', await dataUrlToBlob(compressed.dataUrl), compressed.fileName);
      }
      for (const photo of afterPhotos) {
        const compressed = await compressPhoto(photo.file, stamp);
        formData.append('after', await dataUrlToBlob(compressed.dataUrl), compressed.fileName);
      }
      const token = localStorage.getItem('token');
      const reportPart = item.reportId ? String(item.reportId) : '0';
      const response = await fetch(`https://opu.ic-group.kz/api/pst/${reportPart}/add-photos?locationId=${item.id}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Не удалось загрузить фото');
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setSubmitting(false);
    }
  };

  const hasPhotos = beforePhotos.length > 0 || afterPhotos.length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', background: '#f7f8f3', borderRadius: '28px 28px 0 0', padding: '20px 18px 28px', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: '#1A1D1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.5)', marginTop: 2 }}>Добавить фото · ID {item.id}</div>
          </div>
          <button onClick={onClose} style={{ flexShrink: 0, background: 'rgba(26,29,30,0.06)', border: 'none', borderRadius: 12, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {error && <div style={{ background: '#fde8e8', color: '#c0392b', padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
        <div className="space-y-4">
          <PhotoUploadSection section="before" photos={beforePhotos} onSelect={() => {}} onRemove={removePhoto} onCameraCapture={handleCameraCapture} />
          <PhotoUploadSection section="after" photos={afterPhotos} onSelect={() => {}} onRemove={removePhoto} onCameraCapture={handleCameraCapture} />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !hasPhotos}
          style={{ width: '100%', marginTop: 18, padding: '15px', borderRadius: 18, border: 'none', background: '#1A1D1E', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: (submitting || !hasPhotos) ? 0.5 : 1 }}
        >
          {submitting ? 'Загрузка...' : 'Сохранить фото'}
        </button>
      </div>
    </div>
  );
};

const PstPage = () => {
  const [locations, setLocations] = useState([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(true);
  const [locationsError, setLocationsError] = useState('');
  const [geoState, setGeoState] = useState('idle');
  const [geoError, setGeoError] = useState('');
  const [coords, setCoords] = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const photosSectionRef = useRef(null);
  const [searchParams] = useSearchParams();
  const scanEnabled = searchParams.get('scan') === '1';
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanRafRef = useRef(null);
  const [beforePhotos, setBeforePhotos] = useState([]);
  const [afterPhotos, setAfterPhotos] = useState([]);
  const [submitError, setSubmitError] = useState('');
  const [workType, setWorkType] = useState('ПОЛНАЯ МОЙКА');
  const [showWorkTypeModal, setShowWorkTypeModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [tab, setTab] = useState('wash');
  const [washedList, setWashedList] = useState(() => {
    try {
      const today = new Date().toDateString()
      const stored = JSON.parse(localStorage.getItem('pst_washed_list') || '[]')
      return stored.filter(item => new Date(item.time).toDateString() === today)
    } catch { return [] }
  });
  const [addPhotosFor, setAddPhotosFor] = useState(null);
  const [addPhotosDone, setAddPhotosDone] = useState({});
  const [isRestoringDraft, setIsRestoringDraft] = useState(true);
  const [draftNotice, setDraftNotice] = useState('');
  const isSubmittingRef = useRef(false);
  const hasHydratedDraftRef = useRef(false);
  const draftSaveTimeoutRef = useRef(null);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const stopScanner = useCallback(() => {
    if (scanRafRef.current) { cancelAnimationFrame(scanRafRef.current); scanRafRef.current = null; }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setScannerOpen(false);
    setScanError('');
  }, []);

  const openScanner = useCallback(async () => {
    setScanError('');
    setScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const tick = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
          scanRafRef.current = requestAnimationFrame(tick); return;
        }
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code?.data) {
          const match = code.data.match(/^PST(\d+)/i);
          if (match) {
            const pstId = match[1];
            const found = indexedLocations.find(l => l.id === pstId);
            if (!found) {
              setScanError(`Постомат ID ${pstId} не найден в системе`);
              scanRafRef.current = requestAnimationFrame(tick);
              return;
            }
            stopScanner();
            setSelectedLocationId(pstId);
            setTimeout(() => photosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            return;
          }
        }
        scanRafRef.current = requestAnimationFrame(tick);
      };
      scanRafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setScanError('Нет доступа к камере. Разрешите доступ и попробуйте снова.');
    }
  }, [stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  useEffect(() => {
    document.title = 'Админка | IC Group';
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadLocations = async () => {
      setIsLoadingLocations(true);
      setLocationsError('');
      try {
        // Проверяем кеш
        try {
          const cached = localStorage.getItem(FEED_CACHE_KEY);
          if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < FEED_CACHE_TTL && Array.isArray(data) && data.length > 0) {
              if (isMounted) { setLocations(data); setIsLoadingLocations(false); }
              // Фоновое обновление кеша
              fetch('https://opu.ic-group.kz/api/locations/feed')
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ data: d, ts: Date.now() })) })
                .catch(() => {});
              return;
            }
          }
        } catch {}
        const response = await fetch('https://opu.ic-group.kz/api/locations/feed');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        try { localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ data: payload, ts: Date.now() })); } catch {}
        if (isMounted) setLocations(payload);
      } catch (error) {
        console.error('Failed to load PST locations:', error);
        // Пробуем отдать кеш даже если просрочен
        try {
          const cached = localStorage.getItem(FEED_CACHE_KEY);
          if (cached) { const { data } = JSON.parse(cached); if (data?.length) { if (isMounted) setLocations(data); return; } }
        } catch {}
        if (isMounted) setLocationsError('Не удалось загрузить базу адресов. Обновите страницу и попробуйте еще раз.');
      } finally {
        if (isMounted) setIsLoadingLocations(false);
      }
    };
    loadLocations();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    return () => {
      [...beforePhotos, ...afterPhotos].forEach((photo) => {
        if (photo.previewUrl.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl);
      });
    };
  }, [afterPhotos, beforePhotos]);

  useEffect(() => {
    let isMounted = true;
    const restoreDraft = async () => {
      try {
        const draft = await loadDraft();
        if (!isMounted || !draft) return;
        const restoredBeforePhotos = await Promise.all((draft.beforePhotos ?? draft.photos ?? []).map(draftPhotoToPhotoItem));
        const restoredAfterPhotos = await Promise.all((draft.afterPhotos ?? []).map(draftPhotoToPhotoItem));
        if (!isMounted) {
          [...restoredBeforePhotos, ...restoredAfterPhotos].forEach((photo) => {
            if (photo.previewUrl.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl);
          });
          return;
        }
        setSelectedLocationId(draft.selectedLocationId);
        setBeforePhotos(restoredBeforePhotos);
        setAfterPhotos(restoredAfterPhotos);
        if (draft.selectedLocationId || restoredBeforePhotos.length > 0 || restoredAfterPhotos.length > 0) {
          setDraftNotice('Черновик восстановлен. Можно продолжать и собрать фото до и после в одну отправку.');
        }
      } catch (error) {
        console.error('Failed to restore PST draft:', error);
      } finally {
        if (isMounted) {
          hasHydratedDraftRef.current = true;
          setIsRestoringDraft(false);
        }
      }
    };
    restoreDraft();
    return () => {
      isMounted = false;
      if (draftSaveTimeoutRef.current !== null) window.clearTimeout(draftSaveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedDraftRef.current) return;
    if (draftSaveTimeoutRef.current !== null) window.clearTimeout(draftSaveTimeoutRef.current);
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      const persistDraft = async () => {
        try {
          if (!selectedLocationId && beforePhotos.length === 0 && afterPhotos.length === 0) {
            await clearDraft(); return;
          }
          const storedBeforePhotos = await Promise.all(beforePhotos.map(photoItemToDraftPhoto));
          const storedAfterPhotos = await Promise.all(afterPhotos.map(photoItemToDraftPhoto));
          await saveDraft({
            id: PST_DRAFT_KEY, selectedLocationId,
            beforePhotos: storedBeforePhotos, afterPhotos: storedAfterPhotos,
            updatedAt: new Date().toISOString(),
          });
        } catch (error) { console.error('Failed to persist PST draft:', error); }
      };
      void persistDraft();
    }, 250);
    return () => { if (draftSaveTimeoutRef.current !== null) window.clearTimeout(draftSaveTimeoutRef.current); };
  }, [afterPhotos, beforePhotos, selectedLocationId]);

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoState('unsupported');
      setGeoError('На этом устройстве геолокация недоступна.');
      return;
    }
    setGeoState('loading');
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
        setGeoState('ready');
      },
      (error) => {
        console.error('PST geolocation error:', error);
        setGeoState('denied');
        setGeoError('Доступ к геолокации ограничен. Пожалуйста, разрешите доступ для продолжения.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  useEffect(() => { requestLocation(); }, []);

  const indexedLocations = useMemo(
    () => locations.map((location) => ({ ...location, searchIndex: buildSearchIndex(location) })),
    [locations]
  );

  const nearestLocations = useMemo(() => {
    if (!coords) return [];
    return indexedLocations
      .map((location) => ({ ...location, distanceKm: getDistanceKm(coords, location) }))
      .filter((location) => location.distanceKm <= SEARCH_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);
  }, [coords, indexedLocations]);

  const manualResults = useMemo(() => {
    const normalizedTerm = normalizeSearch(deferredSearchTerm);
    if (!normalizedTerm) return nearestLocations;
    return indexedLocations
      .filter((location) => location.searchIndex.includes(normalizedTerm))
      .map((location) => ({ ...location, distanceKm: coords ? getDistanceKm(coords, location) : Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 30);
  }, [coords, deferredSearchTerm, indexedLocations, nearestLocations]);

  const visibleLocations = searchTerm ? manualResults : [];
  const selectedLocation = indexedLocations.find((location) => location.id === selectedLocationId) ?? null;
  const selectedDistance = coords && selectedLocation ? getDistanceKm(coords, selectedLocation) : null;

  const handlePhotosSelected = (event, section) => {
    const nextFiles = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (nextFiles.length === 0) return;
    const createdAt = new Date().toISOString();
    const nextItems = nextFiles.map((file, index) => ({
      id: `${createdAt}-${index}-${file.name}`, file,
      previewUrl: URL.createObjectURL(file), addedAt: createdAt,
    }));
    if (section === 'before') setBeforePhotos((current) => [...current, ...nextItems]);
    else setAfterPhotos((current) => [...current, ...nextItems]);
    event.target.value = '';
  };

  const handleCameraCapture = (file, section) => {
    const addedAt = new Date().toISOString()
    const item = { id: `${addedAt}-${file.name}`, file, previewUrl: URL.createObjectURL(file), addedAt }
    if (section === 'before') setBeforePhotos(c => [...c, item])
    else setAfterPhotos(c => [...c, item])
  }

  const removePhoto = (photoId, section) => {
    const updatePhotos = section === 'before' ? setBeforePhotos : setAfterPhotos;
    updatePhotos((current) => {
      const photoToRemove = current.find((photo) => photo.id === photoId);
      if (photoToRemove?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(photoToRemove.previewUrl);
      return current.filter((photo) => photo.id !== photoId);
    });
  };

  const hasBeforePhotos = beforePhotos.length > 0;
  const hasAfterPhotos = afterPhotos.length > 0;
  const isReady = Boolean(selectedLocation && hasBeforePhotos && hasAfterPhotos);

  const handleSubmit = () => {
    if (!isReady || isSubmittingRef.current) return;
    if (!selectedLocation) { setSubmitError('Сначала выберите локацию.'); return; }
    if (!hasBeforePhotos || !hasAfterPhotos) { setSubmitError('Для отправки нужно добавить хотя бы одно фото в разделы «До» и «После».'); return; }
    setWorkType('ПОЛНАЯ МОЙКА');
    setShowWorkTypeModal(true);
  };

  const handleConfirmSubmit = async () => {
    setShowWorkTypeModal(false);
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const submittedAt = new Date().toISOString();
      const stamp = { submittedAt, address: selectedLocation.address, city: selectedLocation.city };
      const compressedBeforePhotos = await Promise.all(beforePhotos.map((photo) => compressPhoto(photo.file, stamp)));
      const compressedAfterPhotos = await Promise.all(afterPhotos.map((photo) => compressPhoto(photo.file, stamp)));
      const reportMeta = {
        payloadVersion: PST_PAYLOAD_VERSION,
        clientBuildId: String(import.meta.env.VITE_APP_BUILD_ID || '').trim() || 'dev-build',
        submittedAt,
        location: {
          id: selectedLocation.id,
          title: capitalizeFirstLetter(selectedLocation.hint || selectedLocation.comment || selectedLocation.address),
          city: selectedLocation.city, branch: selectedLocation.branch, address: selectedLocation.address,
          category: selectedLocation.category, installPlace: selectedLocation.installPlace,
          surfaceType: selectedLocation.surfaceType, cellsCount: selectedLocation.cellsCount,
          lat: selectedLocation.lat, lng: selectedLocation.lng,
          distanceMeters: selectedDistance !== null ? Math.round(selectedDistance * 1000) : null,
        },
        userLocation: coords ? { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy ?? null } : null,
        workType,
      };

      // FormData — iOS Safari корректно отправляет бинарные файлы в отличие от JSON+base64
      const formData = new FormData();
      formData.append('report', JSON.stringify(reportMeta));

      const dataUrlToBlob = async (dataUrl) => {
        const res = await fetch(dataUrl);
        return res.blob();
      };

      for (const photo of compressedBeforePhotos) {
        const blob = await dataUrlToBlob(photo.dataUrl);
        formData.append('before', blob, photo.fileName);
      }
      for (const photo of compressedAfterPhotos) {
        const blob = await dataUrlToBlob(photo.dataUrl);
        formData.append('after', blob, photo.fileName);
      }

      const token = localStorage.getItem('token');
      const response = await fetch('https://opu.ic-group.kz/api/pst', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Сервер вернул ошибку ${response.status}`);
      }
      const responseData = await response.json().catch(() => ({}));
      await clearDraft();
      [...beforePhotos, ...afterPhotos].forEach((photo) => {
        if (photo.previewUrl.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl);
      });
      setBeforePhotos([]); setAfterPhotos([]); setSelectedLocationId(''); setSearchTerm(''); setDraftNotice('');
      const newEntry = {
        id: selectedLocation.id,
        reportId: responseData?.report?.id ?? null,
        name: capitalizeFirstLetter(selectedLocation.hint || selectedLocation.comment || selectedLocation.address),
        address: selectedLocation.address,
        city: selectedLocation.city,
        time: submittedAt,
      }
      setWashedList(prev => {
        const updated = [newEntry, ...prev]
        try {
          const existing = JSON.parse(localStorage.getItem('pst_washed_list') || '[]')
          const today = new Date().toDateString()
          const filtered = existing.filter(i => new Date(i.time).toDateString() === today)
          localStorage.setItem('pst_washed_list', JSON.stringify([newEntry, ...filtered]))
        } catch {}
        return updated
      })
      setIsSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Failed to submit PST cleaning report:', error);
      setSubmitError(error instanceof Error ? error.message : 'Не удалось отправить отчёт.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <>
      <div className="min-h-screen bg-brand-light flex flex-col items-center p-6" style={{ paddingTop: 90 }}>
        <div className="max-w-md w-full bg-white rounded-[40px] p-10 shadow-premium text-center">
          <div className="w-20 h-20 bg-brand-green/10 rounded-full flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 style={{ color: '#8fc640' }} size={40} />
          </div>
          <h1 className="text-2xl font-black text-brand-dark mb-4 uppercase">Готово</h1>
          <p className="text-sm leading-6 text-brand-dark/60">
            Локация выбрана, фото зафиксированы. Можно переходить к следующему этапу.
          </p>
          <button type="button" onClick={() => setIsSubmitted(false)} className="btn-premium w-full mt-6">
            Следующий постомат
          </button>
        </div>

        {washedList.length > 0 && (
          <div style={{ maxWidth: 440, width: '100%', marginTop: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(26,29,30,0.4)', marginBottom: 10 }}>
              Помытые сегодня — {washedList.length} шт.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {washedList.map((item, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(26,29,30,0.4)', background: 'rgba(26,29,30,0.05)', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>ID {item.id}</span>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#1A1D1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.45)', marginTop: 2 }}>{item.address}</div>
                  </div>
                  <div style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#8fc640' }}>
                    {new Date(item.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddPhotosFor(item)}
                    title="Добавить фото"
                    style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: 'none', background: addPhotosDone[item.time] ? '#e6f4d7' : 'rgba(26,29,30,0.06)', color: addPhotosDone[item.time] ? '#5a7d20' : '#1A1D1E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    {addPhotosDone[item.time] ? <CheckCircle2 size={16} /> : <Plus size={16} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {addPhotosFor && (
        <AddMorePhotosModal
          item={addPhotosFor}
          onClose={() => setAddPhotosFor(null)}
          onDone={() => { setAddPhotosDone((d) => ({ ...d, [addPhotosFor.time]: true })); setAddPhotosFor(null); }}
        />
      )}
      </>
    );
  }

  return (
    <>
      {/* Шапка-остров */}
      <div style={{ position: 'fixed', top: 12, left: 12, right: 12, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(26,29,30,0.88)', backdropFilter: 'blur(16px)', borderRadius: 50, padding: '8px 8px 8px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <img src="/logo_IC_group.png" alt="IC Group" style={{ height: 26, width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.9, flexShrink: 0 }} />
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', borderRadius: 40, padding: 3, gap: 2 }}>
          {[['wash', 'Мойка'], ['washed', `Помытые${washedList.length > 0 ? ` · ${washedList.length}` : ''}`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '8px 22px', borderRadius: 40, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 800, fontFamily: 'inherit', transition: 'all 0.18s', whiteSpace: 'nowrap',
              background: tab === key ? '#8fc640' : 'transparent',
              color: tab === key ? '#1A1D1E' : 'rgba(255,255,255,0.6)',
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="min-h-screen bg-brand-light pb-16" style={{ paddingTop: 72 }}>
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12">
          {tab === 'wash' && (
          <>
          <h1 style={{ textAlign: 'center', fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.05, letterSpacing: '0.04em', color: '#1A1D1E', fontSize: 'clamp(1.8rem,5vw,3.2rem)', marginTop: '1.5rem' }}>
            Уборка<br />
            <span style={{ color: '#8fc640' }}>Kaspi Postomat</span>
          </h1>
          </>
          )}

          {tab === 'washed' && (
            <div style={{ marginTop: '1.5rem' }}>
              {washedList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(26,29,30,0.35)', fontSize: 15, fontWeight: 600 }}>
                  Сегодня ещё не помыто ни одного постомата
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(26,29,30,0.4)', marginBottom: 12 }}>
                    Помытые сегодня — {washedList.length} шт.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {washedList.map((item, i) => (
                      <div key={i} style={{ background: '#fff', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid rgba(143,198,64,0.2)' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(26,29,30,0.4)', background: 'rgba(26,29,30,0.05)', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>ID {item.id}</span>
                            <div style={{ fontWeight: 800, fontSize: 14, color: '#1A1D1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          </div>
                          <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.45)', marginTop: 3 }}>{item.address}</div>
                        </div>
                        <div style={{ flexShrink: 0, fontSize: 15, fontWeight: 800, color: '#8fc640' }}>
                          {new Date(item.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <button
                          type="button"
                          onClick={() => setAddPhotosFor(item)}
                          title="Добавить фото"
                          style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, border: 'none', background: addPhotosDone[item.time] ? '#e6f4d7' : 'rgba(26,29,30,0.06)', color: addPhotosDone[item.time] ? '#5a7d20' : '#1A1D1E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          {addPhotosDone[item.time] ? <CheckCircle2 size={17} /> : <Plus size={17} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {addPhotosFor && (
            <AddMorePhotosModal
              item={addPhotosFor}
              onClose={() => setAddPhotosFor(null)}
              onDone={() => { setAddPhotosDone((d) => ({ ...d, [addPhotosFor.time]: true })); setAddPhotosFor(null); }}
            />
          )}

          {tab === 'wash' && (<div className="mx-auto mt-8 max-w-[690px]">
            {(geoState === 'denied' || geoState === 'unsupported') && (
              <div className="rounded-[36px] border border-[#f5d7d6] bg-[#fff5f5] px-6 py-5 shadow-[0_18px_40px_rgba(242,107,104,0.08)] sm:px-8">
                <div className="flex items-start gap-4">
                  <span style={{ marginTop: 10, height: 12, width: 6, flexShrink: 0, borderRadius: 9999, background: '#f26b68', display: 'inline-block' }} />
                  <span style={{ textAlign: 'left', fontSize: 'clamp(1rem,1.8vw,1.45rem)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.45, letterSpacing: '0.01em', color: '#f26b68' }}>
                    {geoError}
                  </span>
                </div>
                {geoState === 'denied' && (
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="mt-4 flex items-center gap-2 rounded-full border border-[#f26b68]/30 bg-white px-4 py-2 text-sm font-black uppercase tracking-[0.02em] text-[#f26b68]"
                  >
                    <RefreshCw size={15} /> Обновить геолокацию
                  </button>
                )}
              </div>
            )}

            {geoState === 'ready' && coords && (
              <div className="rounded-[28px] border border-brand-green/20 bg-brand-green/10 px-6 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-base font-black uppercase tracking-[0.02em] text-brand-green">
                    <LocateFixed size={18} />
                    Геолокация определена
                  </div>
                  {!scanEnabled && (
                    <button
                      type="button"
                      onClick={requestLocation}
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-brand-green/25 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-[0.02em] text-brand-green"
                    >
                      <RefreshCw size={13} /> Обновить
                    </button>
                  )}
                </div>
                <div className="mt-2 text-sm font-semibold leading-6 text-brand-dark/60">
                  GPS: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                  {coords.accuracy ? `, точность ${Math.round(coords.accuracy)} м` : ''}
                </div>
              </div>
            )}

            {(geoState === 'loading' || geoState === 'idle') && (
              <div className="rounded-[28px] border border-black/5 bg-white px-6 py-5 text-base font-bold leading-7 text-brand-dark/60 shadow-premium">
                <div className="flex items-center gap-3">
                  <div style={{ height: 16, width: 16, borderRadius: 9999, border: '2px solid rgba(26,29,30,0.15)', borderTopColor: '#8fc640', animation: 'spin 1s linear infinite' }} />
                  Запрашиваем координаты устройства...
                </div>
              </div>
            )}
          </div>)}
        </div>

        {tab === 'wash' && <><div className="space-y-6">
          <section>
            <div className="mx-auto max-w-[690px]">
              {!isLoadingLocations && (
                <>
                  <div className="mt-6">
                    <div style={{ display: 'flex', gap: 10, marginBottom: '1rem' }}>
                      {!scanEnabled && <div style={{ position: 'relative', flex: 1 }}>
                        <input
                          type="search"
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                          placeholder="Поиск по ID, адресу, названию..."
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            padding: '14px 44px 14px 18px',
                            borderRadius: 20, border: '1.5px solid rgba(26,29,30,0.1)',
                            background: '#fff', fontSize: '0.9rem', fontWeight: 600,
                            fontFamily: 'inherit', color: '#1A1D1E',
                            outline: 'none', boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
                          }}
                          onFocus={e => e.target.style.borderColor = '#8fc640'}
                          onBlur={e => e.target.style.borderColor = 'rgba(26,29,30,0.1)'}
                        />
                        <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 18, opacity: 0.35, pointerEvents: 'none' }}>🔍</span>
                      </div>}
                      {scanEnabled && (
                        <button
                          onClick={openScanner}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 12, padding: '16px 24px', border: 'none', borderRadius: 20,
                            background: 'linear-gradient(135deg, #8fc640 0%, #6fa832 100%)',
                            color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                            fontWeight: 900, fontSize: '0.95rem', letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            boxShadow: '0 8px 24px rgba(143,198,64,0.4), 0 2px 6px rgba(143,198,64,0.2)',
                          }}
                        >
                          <QrCode size={22} strokeWidth={2.5} />
                          Отсканировать QR
                        </button>
                      )}
                    </div>

                    {scannerOpen && (
                      <div style={{
                        position: 'fixed', inset: 0, zIndex: 9999,
                        background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
                          <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 20, display: 'block' }} />
                          <canvas ref={canvasRef} style={{ display: 'none' }} />
                          <div style={{
                            position: 'absolute', inset: 0, pointerEvents: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <div style={{ width: 220, height: 220, border: '3px solid #8fc640', borderRadius: 20, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
                          </div>
                        </div>
                        {scanError && (
                          <div style={{ color: '#ff6b6b', marginTop: 16, fontWeight: 700, textAlign: 'center', padding: '0 24px' }}>
                            {scanError}
                          </div>
                        )}
                        <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: 20, fontSize: '0.85rem', fontWeight: 600 }}>
                          Наведите камеру на QR-код постомата
                        </p>
                        <button onClick={stopScanner} style={{
                          marginTop: 24, padding: '12px 32px', borderRadius: 14, border: 'none',
                          background: 'rgba(255,255,255,0.12)', color: '#fff', fontWeight: 700,
                          fontSize: '0.95rem', cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                          Отмена
                        </button>
                      </div>
                    )}

                    {visibleLocations.length > 0 && (
                      <div className="mb-4 text-[11px] font-black uppercase tracking-[0.24em] text-brand-dark/45">
                        {searchTerm ? 'Результаты поиска' : geoState === 'ready' ? 'Ближайшие объекты' : 'Выберите объект'}
                      </div>
                    )}

                    <div style={{ overflow: 'hidden', borderRadius: 28, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.05)' }}>
                      <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                        {visibleLocations.map((location) => {
                          const isSelected = location.id === selectedLocationId;
                          return (
                            <button
                              key={`location-${location.id}`}
                              type="button"
                              onClick={() => { setSelectedLocationId(location.id); setTimeout(() => photosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }}
                              style={{
                                display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '0.75rem',
                                padding: '1rem', width: '100%', textAlign: 'left', border: 'none',
                                background: isSelected ? '#f5fbe9' : '#fff',
                                boxShadow: isSelected ? 'inset 4px 0 0 #8fc640' : 'none',
                                cursor: 'pointer', transition: 'all 0.2s ease', fontFamily: 'inherit',
                                borderTop: '1px solid rgba(0,0,0,0.06)',
                              }}
                            >
                              <div style={{
                                display: 'flex', height: 28, width: 28, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
                                borderRadius: 8, border: `2px solid ${isSelected ? '#8fc640' : 'rgba(26,29,30,0.16)'}`,
                                background: isSelected ? '#8fc640' : '#fff',
                              }}>
                                {isSelected && <CheckCircle2 size={16} style={{ color: '#1A1D1E' }} />}
                              </div>

                              <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                                  <span className={chipClass} style={{ background: 'rgba(26,29,30,0.05)', color: 'rgba(26,29,30,0.55)' }}>
                                    ID {location.id}
                                  </span>
                                  <span className={chipClass} style={{
                                    background: location.installPlace === 'Уличный' ? '#e9f3ff' : '#eef6e3',
                                    color: location.installPlace === 'Уличный' ? '#2b6cb0' : '#5a7d20',
                                  }}>
                                    {location.installPlace}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                                {Number.isFinite(location.distanceKm) && location.distanceKm !== Number.POSITIVE_INFINITY && (
                                  <span style={{ borderRadius: 9999, background: 'rgba(26,29,30,0.05)', padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 900, color: 'rgba(26,29,30,0.55)' }}>
                                    {formatDistance(location.distanceKm)}
                                  </span>
                                )}
                                <ChevronRight size={18} style={{ color: isSelected ? '#8fc640' : 'rgba(26,29,30,0.22)' }} />
                              </div>
                            </button>
                          );
                        })}

                        {searchTerm && manualResults.length === 0 && (
                          <div style={{ borderRadius: 24, border: '1px dashed rgba(26,29,30,0.12)', background: '#fff', padding: '1.25rem', fontSize: '0.875rem', fontWeight: 600, color: 'rgba(26,29,30,0.55)' }}>
                            Совпадений не найдено. Попробуйте адрес, магазин, комментарий или номер постамата.
                          </div>
                        )}

                        {!searchTerm && nearestLocations.length === 0 && (
                          <div style={{ borderRadius: 24, border: '1px dashed rgba(26,29,30,0.12)', background: '#fff', padding: '1.25rem', fontSize: '0.875rem', fontWeight: 600, color: 'rgba(26,29,30,0.55)' }}>
                            {geoState === 'ready'
                              ? 'В радиусе 300 м ничего не найдено. Введите адрес или номер постамата в строку поиска выше.'
                              : 'Введите адрес, название магазина или номер постамата для поиска.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {selectedLocation && (
                <div style={{ marginTop: '2rem', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '2rem' }}>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-dark/45 mb-4">
                    Выбранная локация
                  </div>
                  <div style={{ borderRadius: 28, background: '#1A1D1E', padding: '1.25rem', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={chipClass} style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}>
                        ID {selectedLocation.id}
                      </span>
                      <span className={chipClass} style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}>
                        {selectedLocation.installPlace}
                      </span>
                      {selectedDistance !== null && (
                        <span className={chipClass} style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}>
                          {formatDistance(selectedDistance)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {selectedLocation && (
            <section style={{ borderRadius: 32, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', padding: '1.5rem', boxShadow: '0 18px 50px rgba(15,23,42,0.06)' }}>
              {draftNotice && (
                <div style={{ marginBottom: '1.25rem', borderRadius: 24, border: '1px solid rgba(143,198,64,0.2)', background: 'rgba(143,198,64,0.1)', padding: '1rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.6, color: 'rgba(26,29,30,0.72)' }}>
                  {draftNotice}
                </div>
              )}

              {isRestoringDraft && (
                <div style={{ marginBottom: '1.25rem', borderRadius: 24, border: '1px solid rgba(0,0,0,0.06)', background: '#fbfcf8', padding: '1rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.6, color: 'rgba(26,29,30,0.55)' }}>
                  Восстанавливаем неотправленные фото из черновика...
                </div>
              )}

              <div className="space-y-5" ref={photosSectionRef}>
                <PhotoUploadSection section="before" photos={beforePhotos} onSelect={handlePhotosSelected} onRemove={removePhoto} onCameraCapture={handleCameraCapture} />
                <PhotoUploadSection section="after" photos={afterPhotos} onSelect={handlePhotosSelected} onRemove={removePhoto} onCameraCapture={handleCameraCapture} />
              </div>

              {submitError && (
                <div style={{ marginTop: '1.25rem', borderRadius: 24, border: '1px solid #fee2e2', background: '#fef2f2', padding: '1rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#dc2626' }}>
                  {submitError}
                </div>
              )}

              <div style={{ marginTop: '1.5rem' }}>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!isReady || isSubmitting}
                  style={{
                    width: '100%', borderRadius: 16, padding: '1rem 1.5rem',
                    fontSize: '0.875rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em',
                    cursor: isReady && !isSubmitting ? 'pointer' : 'not-allowed',
                    background: isReady && !isSubmitting ? '#8fc640' : 'rgba(26,29,30,0.08)',
                    color: isReady && !isSubmitting ? '#1A1D1E' : 'rgba(26,29,30,0.35)',
                    border: 'none', transition: 'all 0.2s ease', fontFamily: 'inherit',
                  }}
                >
                  {isSubmitting ? 'Отправляем...' : 'Отправить →'}
                </button>
                {!isReady && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.6, color: 'rgba(26,29,30,0.48)' }}>
                    {selectedLocation
                      ? !hasBeforePhotos && !hasAfterPhotos
                        ? 'Добавьте фотографии в разделы «До» и «После», чтобы отправить уборку одной целой записью.'
                        : !hasBeforePhotos
                          ? 'Добавьте хотя бы одно фото в раздел «До».'
                          : 'Добавьте хотя бы одно фото в раздел «После».'
                      : 'Сначала выберите локацию и добавьте фото до и после уборки.'}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {locationsError && (
          <div style={{ marginTop: '1.5rem', borderRadius: 24, border: '1px solid #fee2e2', background: '#fef2f2', padding: '1rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#dc2626' }}>
            {locationsError}
          </div>
        )}
        </>}
      </div>
    </div>

    {/* МОДАЛКА ВЫБОРА ТИПА РАБОТЫ */}
    {showWorkTypeModal && (
      <div
        onClick={() => setShowWorkTypeModal(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 600,
          background: 'rgba(15,23,42,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 520,
            background: '#f7f8f3',
            borderRadius: '28px 28px 0 0',
            padding: '28px 20px 40px',
            boxSizing: 'border-box',
          }}
        >
          {/* Ручка */}
          <div style={{ width: 40, height: 4, background: 'rgba(26,29,30,0.15)', borderRadius: 99, margin: '0 auto 24px' }} />

          <div style={{ fontSize: 20, fontWeight: 900, color: '#1A1D1E', marginBottom: 6 }}>
            Тип работы
          </div>
          <div style={{ fontSize: 13, color: 'rgba(26,29,30,0.5)', marginBottom: 24, lineHeight: 1.5 }}>
            Выберите тип выполненной работы перед отправкой
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {[
              { type: 'ПОЛНАЯ МОЙКА',   desc: 'Полная уборка постомата снаружи и внутри' },
              { type: 'НАРУЖНЯЯ МОЙКА', desc: 'Уборка только внешних поверхностей' },
              { type: 'ИНЦИДЕНТ',        desc: 'Устранение загрязнения или инцидента' },
            ].map(({ type, desc }) => (
              <button
                key={type}
                type="button"
                onClick={() => setWorkType(type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', borderRadius: 18, border: 'none',
                  background: workType === type ? '#8fc640' : '#fff',
                  cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: workType === type ? '0 4px 16px rgba(143,198,64,0.3)' : '0 1px 4px rgba(0,0,0,0.06)',
                  transition: 'all 0.15s', textAlign: 'left',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  border: workType === type ? '2px solid #1A1D1E' : '2px solid rgba(26,29,30,0.2)',
                  background: workType === type ? '#1A1D1E' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {workType === type && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8fc640' }} />}
                </div>
                <div>
                  <div style={{
                    fontSize: 13, fontWeight: 800, textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: workType === type ? '#1A1D1E' : 'rgba(26,29,30,0.8)',
                  }}>{type}</div>
                  <div style={{
                    fontSize: 12, fontWeight: 500, marginTop: 2,
                    color: workType === type ? 'rgba(26,29,30,0.65)' : 'rgba(26,29,30,0.45)',
                  }}>{desc}</div>
                </div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleConfirmSubmit}
            style={{
              width: '100%', padding: '16px', borderRadius: 18, border: 'none',
              background: '#1A1D1E', color: '#fff',
              fontSize: 15, fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '0.12em', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Отправить отчёт
          </button>
        </div>
      </div>
    )}
    </>
  );
};

export default PstPage;
