import * as Location from 'expo-location';
import { getCampusReminderTasks, getSetting, setSetting } from './db';
import { notifyCampusTasks } from './notifications';

export async function requestCampusLocationPermission(): Promise<boolean> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    console.log('[Campus Location] Existing permission status:', current.status, 'granted:', current.granted);
    if (current.granted) return true;

    const requested = await Location.requestForegroundPermissionsAsync();
    console.log('[Campus Location] Requested permission result:', requested.status, 'granted:', requested.granted);
    return requested.granted;
  } catch (error) {
    console.warn('[Campus Location] Permission request error:', error);
    return false;
  }
}

export async function getCurrentCampusLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const granted = await requestCampusLocationPermission();
  if (!granted) {
    throw new Error('Location permission is required to detect your current position.');
  }

  try {
    const isEnabled = await Location.hasServicesEnabledAsync();
    if (!isEnabled) {
      throw new Error('Device location (GPS) services are turned off. Please turn them on in device settings.');
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    console.log('[Campus Location] Current GPS retrieved:', pos.coords.latitude, pos.coords.longitude);
    return {
      latitude: Number(pos.coords.latitude.toFixed(6)),
      longitude: Number(pos.coords.longitude.toFixed(6)),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not retrieve current position';
    throw new Error(`Location lookup failed: ${msg}`);
  }
}

export async function geocodeCampusAddress(
  address: string
): Promise<{ latitude: number; longitude: number; displayName: string } | null> {
  const query = address.trim();
  if (!query) return null;

  // 1. First try expo-location's built-in geocoding
  try {
    const results = await Location.geocodeAsync(query);
    if (results && results.length > 0 && results[0]) {
      const first = results[0];
      console.log('[Campus Geocode] Native geocode matched:', first.latitude, first.longitude);
      return {
        latitude: Number(first.latitude.toFixed(6)),
        longitude: Number(first.longitude.toFixed(6)),
        displayName: query,
      };
    }
  } catch (err) {
    console.warn('[Campus Geocode] Native geocode failed, trying OSM Nominatim fallback...', err);
  }

  // 2. Fallback to OpenStreetMap Nominatim free geocoding
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'StudyHubStudentApp/1.0 (offline-first student productivity)',
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
      if (data && data.length > 0 && data[0]) {
        const item = data[0];
        console.log('[Campus Geocode] Nominatim matched:', item.lat, item.lon);
        return {
          latitude: Number(Number(item.lat).toFixed(6)),
          longitude: Number(Number(item.lon).toFixed(6)),
          displayName: item.display_name?.split(',').slice(0, 2).join(',') ?? query,
        };
      }
    }
  } catch (err) {
    console.warn('[Campus Geocode] Nominatim geocode error:', err);
  }

  return null;
}

const radians = (value: number) => (value * Math.PI) / 180;

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const earth = 6371000;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(a));
}

export async function checkCampusArrival() {
  const [latRaw, lonRaw, radiusRaw, enabled, last] = await Promise.all([
    getSetting('campus_latitude'),
    getSetting('campus_longitude'),
    getSetting('campus_radius'),
    getSetting('campus_location_enabled'),
    getSetting('campus_last_notified'),
  ]);

  console.log('[Campus Arrival Check] Enabled:', enabled, 'Target Lat:', latRaw, 'Target Lon:', lonRaw);
  if (enabled !== 'true' || !latRaw || !lonRaw) return false;

  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      console.log('[Campus Arrival Check] Location permission not granted');
      return false;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (last === today) {
      console.log('[Campus Arrival Check] Already notified today');
      return false;
    }

    const hasServices = await Location.hasServicesEnabledAsync();
    if (!hasServices) return false;

    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const distance = distanceMeters(
      location.coords.latitude,
      location.coords.longitude,
      Number(latRaw),
      Number(lonRaw)
    );

    const radius = Number(radiusRaw || 200);
    console.log(`[Campus Arrival Check] Current distance to campus: ${Math.round(distance)}m, threshold radius: ${radius}m`);

    if (distance > radius) return false;

    const tasks = await getCampusReminderTasks();
    if (!tasks.length) {
      console.log('[Campus Arrival Check] Inside campus, but no pending campus-reminder tasks');
      return false;
    }

    console.log(`[Campus Arrival Check] Triggering reminder for ${tasks.length} tasks!`);
    await notifyCampusTasks(tasks.length);
    await setSetting('campus_last_notified', today);
    return true;
  } catch (error) {
    console.warn('[Campus Arrival Check] Error checking position:', error);
    return false;
  }
}
