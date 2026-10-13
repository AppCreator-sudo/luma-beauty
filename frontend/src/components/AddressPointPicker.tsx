import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Position = { latitude: number; longitude: number };
export function AddressPointPicker({ center, address, busy, onConfirm }: { center: Position; address: string; busy: boolean; onConfirm: (point: Position) => void }) {
  const element = useRef<HTMLDivElement>(null); const [point, setPoint] = useState<Position | null>(null);
  useEffect(() => {
    if (!element.current) return;
    setPoint(null);
    const map = L.map(element.current, { attributionControl: false, scrollWheelZoom: false }).setView([center.latitude, center.longitude], 16);
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(map);
    let marker: L.Marker | null = null;
    const icon = L.divIcon({ className: 'address-manual-marker', html: '<span>●</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
    function choose(latlng: L.LatLng) { setPoint({ latitude: latlng.lat, longitude: latlng.lng }); }
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (marker) marker.setLatLng(event.latlng);
      else { marker = L.marker(event.latlng, { icon, draggable: true }).addTo(map); marker.on('dragend', () => { if (marker) choose(marker.getLatLng()); }); }
      choose(event.latlng);
    });
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(element.current);
    return () => { observer.disconnect(); map.remove(); };
  }, [center.latitude, center.longitude]);
  return <div className="address-point-picker" aria-busy={busy}><p><strong>{address}</strong> — найдите ваш дом и нажмите на него. Метку можно перетащить.</p><div ref={element} className="address-point-map" role="region" aria-label="Выбор точного дома на карте"/><p className="muted">Карта открыта около адреса. Пока вы не выбрали и не подтвердили дом, точка не сохранена.</p><button className="button button-outline" type="button" disabled={!point || busy} onClick={() => point && onConfirm(point)}>{busy ? 'Подтверждаем…' : 'Это мой дом — подтвердить точку'}</button></div>;
}
