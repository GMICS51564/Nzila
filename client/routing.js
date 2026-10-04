import { osrmRoute, geocodeCongo } from '../assets/js/nzila-utils.js';

export async function buildClientQuote({
  pickup,
  destination,
  sb
}) {
  if (!pickup) {
    throw new Error('PICKUP_LOCATION_MISSING');
  }

  if (!destination) {
    throw new Error('DESTINATION_MISSING');
  }

  if (!sb) {
    throw new Error('SUPABASE_CLIENT_NOT_READY');
  }

  // 1. Transformer l'adresse de destination en coordonnées
  const destinationCoords = await geocodeCongo(destination);

  // 2. Calculer le trajet réel
  const route = await osrmRoute(
    pickup,
    destinationCoords
  );

  // 3. Demander le tarif au backend NZILA
  const { data, error } = await sb.rpc(
    'nzila_quote_ride',
    {
      p_distance_km: route.distance_km,
      p_duration_min: route.duration_min
    }
  );

  if (error) {
    throw error;
  }

  return {
    route,
    destination: destinationCoords,
    quote: data
  };
}
