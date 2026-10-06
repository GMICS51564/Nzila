// driver/gps.js - Gestion propre de la géolocalisation chauffeur
let driverGpsWatchId = null;

export function startDriverGps(driverId, sbClient) {
  if (!navigator.geolocation) {
    console.warn("La géolocalisation n'est pas supportée par ce navigateur.");
    return;
  }

  if (driverGpsWatchId !== null) return;

  driverGpsWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude, accuracy, speed, heading } = position.coords;
      
      if (!driverId || !sbClient) return;

      try {
        const { error } = await sbClient.rpc('nzila_update_driver_location', {
          p_driver_id: driverId,
          p_latitude: latitude,
          p_longitude: longitude,
          p_accuracy: accuracy || null,
          p_speed: speed || null,
          p_heading: heading || null
        });

        if (error) {
          console.warn('Erreur mise à jour position GPS :', error.message);
        }
      } catch (err) {
        console.warn('Erreur réseau GPS :', err);
      }
    },
    (error) => {
      console.warn('Erreur GPS:', error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    }
  );
}

export function stopDriverGps() {
  if (driverGpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(driverGpsWatchId);
    driverGpsWatchId = null;
  }
}
