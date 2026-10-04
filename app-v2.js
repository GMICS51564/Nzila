import { osrmRoute, geocodeCongo } from '../nzila-utils.js';
import { flushClientQueue, queueClientAction } from './offline.js';

window.NZILA_V2 = {
  paymentMethod: 'cash',
  quote: null
};

function installPaymentChoices() {
  const box = document.querySelector('#paymentMethodBox');
  if (!box) return;

  box.innerHTML = `
    <label>Mode de paiement</label>
    <select id="nzilaPaymentMethod">
      <option value="cash">Espèces</option>
      <option value="mtn_money">MTN Mobile Money</option>
      <option value="airtel_money">Airtel Money</option>
    </select>
  `;

  document.querySelector('#nzilaPaymentMethod')
    ?.addEventListener('change', e => {
      window.NZILA_V2.paymentMethod = e.target.value;
    });
}

async function quoteRide() {
  try {
    const pickup = getPickupCoords();
    const destination = document.querySelector('#destination')?.value?.trim();

    if (!pickup || !destination) {
      throw new Error('Veuillez renseigner le départ et la destination.');
    }

    const dest = await geocodeCongo(destination);
    const route = await osrmRoute(pickup, dest);

    const { data, error } = await sb.rpc('nzila_quote_ride', {
      p_distance_km: route.distance_km,
      p_duration_min: route.duration_min
    });

    if (error) throw error;

    window.NZILA_V2.quote = {
      ...route,
      ...(data || {}),
      destination: dest
    };

    const price = Number(
      data?.estimated_price ??
      data?.price ??
      data ??
      0
    );

    const priceEl = document.querySelector('#price');
    if (priceEl) {
      priceEl.textContent =
        `${price.toLocaleString('fr-FR')} FCFA`;
    }

    return window.NZILA_V2.quote;
  } catch (error) {
    console.error(error);
    showToast?.(error.message || 'Impossible de calculer le trajet.');
    return null;
  }
}

async function createRideV2() {
  try {
    const pickup = getPickupCoords();
    const destination = document.querySelector('#destination')?.value?.trim();

    if (!pickup || !destination) {
      throw new Error('Départ ou destination manquant.');
    }

    const quote = window.NZILA_V2.quote || await quoteRide();

    if (!quote) {
      throw new Error('Impossible de calculer le tarif.');
    }

    const payload = {
      p_client_id: user.id,
      p_pickup_address:
        document.querySelector('#pickup')?.value || '',
      p_destination_address: destination,
      p_pickup_lat: pickup.lat,
      p_pickup_lng: pickup.lng,
      p_destination_lat: quote.destination.lat,
      p_destination_lng: quote.destination.lng,
      p_estimated_price:
        Number(
          quote.estimated_price ??
          quote.price ??
          0
        ),
      p_payment_method:
        window.NZILA_V2.paymentMethod || 'cash',
      p_passenger_count:
        Number(document.querySelector('#passengers')?.value || 1),
      p_bags:
        Number(document.querySelector('#bags')?.value || 0)
    };

    const { data, error } =
      await sb.rpc('nzila_create_ride_app', payload);

    if (error) throw error;

    const ride = Array.isArray(data) ? data[0] : data;

    if (!ride?.id) {
      throw new Error('La course n’a pas pu être créée.');
    }

    showToast?.('Course créée avec succès.');

    if (typeof showRideModal === 'function') {
      showRideModal(ride);
    }

    if (typeof subscribeToRide === 'function') {
      subscribeToRide(ride.id);
    }

    if (
      window.NZILA_V2.paymentMethod !== 'cash'
    ) {
      await startMobilePayment(
        ride.id,
        window.NZILA_V2.paymentMethod
      );
    }

    return ride;

  } catch (error) {
    console.error(error);

    if (!navigator.onLine) {
      queueClientAction({
        type: 'create_ride',
        payload: {
          destination:
            document.querySelector('#destination')?.value || ''
        }
      });

      showToast?.(
        'Hors connexion : la demande sera envoyée dès que la connexion revient.'
      );

      return null;
    }

    showToast?.(
      error.message || 'Impossible de créer la course.'
    );

    return null;
  }
}

async function startMobilePayment(rideId, method) {
  const response = await fetch(
    '/functions/v1/payment-create',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ride_id: rideId,
        method
      })
    }
  );

  if (!response.ok) {
    throw new Error('PAYMENT_CREATE_FAILED');
  }

  const result = await response.json();

  if (result.payment_url) {
    window.location.href = result.payment_url;
  }

  return result;
}

async function cancelRideV2(rideId) {
  try {
    const { error } =
      await sb.rpc('nzila_update_ride_status', {
        p_ride_id: rideId,
        p_status: 'cancelled'
      });

    if (error) throw error;

    try {
      await fetch(
        '/functions/v1/payment-refund',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ride_id: rideId
          })
        }
      );
    } catch (paymentError) {
      console.warn(
        'Refund non déclenché:',
        paymentError
      );
    }

    showToast?.('Course annulée.');
    closeRideModal?.();

  } catch (error) {
    console.error(error);
    showToast?.(
      error.message || 'Impossible d’annuler la course.'
    );
  }
}

window.quoteRide = quoteRide;
window.createRideV2 = createRideV2;
window.cancelRideV2 = cancelRideV2;

window.addEventListener('online', () => {
  flushClientQueue();
});

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    installPaymentChoices
  );
} else {
  installPaymentChoices();
}

window.createRide = createRideV2;
window.cancelActiveRide = cancelRideV2;
