import { osrmRoute, geocodeCongo } from '../Asset/JS/nzila-utils.js';
import { flushClientQueue, queueClientAction } from './offline.js';

const sb = window.supabaseClient || window.sb;

window.NZILA_V2 = {
  paymentMethod: 'cash',
  quote: null
};

/* =========================================================
   UTILITAIRES
========================================================= */

function getCurrentUser() {
  return window.currentUser || window.user || null;
}

function getDestinationValue() {
  const input = document.getElementById('destination');
  return input ? input.value.trim() : '';
}

function getManualPickupAddress() {
  const department = document.getElementById('department')?.value?.trim() || '';
  const city = document.getElementById('city')?.value?.trim() || '';
  const neighborhood = document.getElementById('neighborhood')?.value?.trim() || '';
  const pickup = document.getElementById('pickup')?.value?.trim() || '';

  return {
    department,
    city,
    neighborhood,
    pickup
  };
}

function normalizePaymentMethod(method) {
  switch (method) {
    case 'mtn':
      return 'mtn_money';

    case 'airtel':
      return 'airtel_money';

    case 'mtn_money':
      return 'mtn_money';

    case 'airtel_money':
      return 'airtel_money';

    default:
      return 'cash';
  }
}

function localPriceFallback(distanceKm = 0) {
  const base = 1000;
  const perKm = 500;

  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return base;
  }

  return Math.round(base + distanceKm * perKm);
}

function showRouteInfo(distanceKm, durationMin) {
  const distance = Number(distanceKm || 0);
  const duration = Number(durationMin || 0);

  const elements = [
    document.getElementById('routeInfo'),
    document.getElementById('rideRouteInfo'),
    document.getElementById('distanceInfo')
  ].filter(Boolean);

  if (!elements.length) return;

  const text =
    `${distance.toFixed(1)} km · ` +
    `${Math.round(duration)} min`;

  elements.forEach(el => {
    el.textContent = text;
  });
}

/* =========================================================
   LOCALISATION / GPS
========================================================= */

async function getPickupCoords() {
  const mode = window.clientLocationMode || 'manual';

  /* -------------------------
     MODE GPS
  ------------------------- */

  if (mode === 'gps') {
    if (
      Number.isFinite(window.clientGpsLat) &&
      Number.isFinite(window.clientGpsLng)
    ) {
      return [
        window.clientGpsLat,
        window.clientGpsLng
      ];
    }

    if (typeof window.geolocateClient === 'function') {
      await window.geolocateClient();
    }

    if (
      Number.isFinite(window.clientGpsLat) &&
      Number.isFinite(window.clientGpsLng)
    ) {
      return [
        window.clientGpsLat,
        window.clientGpsLng
      ];
    }

    throw new Error(
      'Impossible de récupérer votre position GPS.'
    );
  }

  /* -------------------------
     MODE MANUEL
  ------------------------- */

  const manual = getManualPickupAddress();

  if (!manual.department) {
    throw new Error('Sélectionnez un département.');
  }

  if (!manual.city) {
    throw new Error('Sélectionnez une ville.');
  }

  if (!manual.pickup) {
    throw new Error('Indiquez votre lieu de prise en charge.');
  }

  const parts = [
    manual.pickup,
    manual.neighborhood,
    manual.city,
    manual.department,
    'République du Congo'
  ].filter(Boolean);

  const query = parts.join(', ');

  const result = await geocodeCongo(query);

  if (!result) {
    throw new Error(
      'Impossible de localiser le point de départ.'
    );
  }

  const lat = Number(
    result.lat ?? result.latitude
  );

  const lng = Number(
    result.lon ??
    result.lng ??
    result.longitude
  );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new Error(
      'Les coordonnées du lieu de départ sont invalides.'
    );
  }

  return [lat, lng];
}

/* =========================================================
   DESTINATION + ITINÉRAIRE
========================================================= */

async function getDestinationRoute(pickupCoords) {
  const destination = getDestinationValue();

  if (!destination) {
    throw new Error(
      'Indiquez votre destination.'
    );
  }

  const destinationResult =
    await geocodeCongo(destination);

  if (!destinationResult) {
    throw new Error(
      'Impossible de localiser la destination.'
    );
  }

  const destinationLat = Number(
    destinationResult.lat ??
    destinationResult.latitude
  );

  const destinationLng = Number(
    destinationResult.lon ??
    destinationResult.lng ??
    destinationResult.longitude
  );

  if (
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    throw new Error(
      'Les coordonnées de la destination sont invalides.'
    );
  }

  const [pickupLat, pickupLng] = pickupCoords;

  const route = await osrmRoute(
    pickupLng,
    pickupLat,
    destinationLng,
    destinationLat
  );

  return {
    destinationAddress: destination,
    destinationLatitude: destinationLat,
    destinationLongitude: destinationLng,
    route
  };
}

/* =========================================================
   DEVIS
========================================================= */

async function quoteRide(pickupCoords) {
  try {
    const routeData =
      await getDestinationRoute(pickupCoords);

    const route = routeData.route;

    const distanceKm = Number(
      route?.distanceKm ??
      route?.distance_km ??
      (Number(route?.distance || 0) / 1000)
    );

    const durationMin = Number(
      route?.durationMin ??
      route?.duration_min ??
      (Number(route?.duration || 0) / 60)
    );

    let estimatedPrice =
      localPriceFallback(distanceKm);

    /* -----------------------------------
       Tentative de devis Supabase
    ----------------------------------- */

    try {
      const { data, error } = await sb.rpc(
        'nzila_quote_ride',
        {
          p_distance_km: distanceKm,
          p_duration_min: durationMin,
          p_at: new Date().toISOString(),
          p_passengers:
            Number(
              document.getElementById('passengers')?.value
            ) || 1,
          p_bags:
            Number(
              document.getElementById('bags')?.value
            ) || 0
        }
      );

      if (!error && data) {
        const quote =
          Array.isArray(data) ? data[0] : data;

        if (quote) {
          estimatedPrice = Number(
            quote.estimated_price ??
            quote.price ??
            quote.amount ??
            estimatedPrice
          );
        }
      }
    } catch (quoteError) {
      console.warn(
        'nzila_quote_ride indisponible, utilisation du tarif local.',
        quoteError
      );
    }

    showRouteInfo(
      distanceKm,
      durationMin
    );

    const result = {
      estimatedPrice,
      distanceKm,
      durationMin,
      destinationAddress:
        routeData.destinationAddress,
      destinationLatitude:
        routeData.destinationLatitude,
      destinationLongitude:
        routeData.destinationLongitude
    };

    window.NZILA_V2.quote = result;

    return result;

  } catch (error) {
    console.warn(
      'Calcul itinéraire impossible :',
      error
    );

    return {
      estimatedPrice: localPriceFallback(0),
      distanceKm: 0,
      durationMin: 0,
      destinationAddress:
        getDestinationValue(),
      destinationLatitude: null,
      destinationLongitude: null
    };
  }
}

/* =========================================================
   INTERFACE PAIEMENT
========================================================= */

function addPaymentUI() {
  if (document.getElementById('nzila-payment-ui')) {
    return;
  }

  const createButton =
    document.getElementById('createRide') ||
    document.querySelector(
      '[onclick="createRide()"]'
    );

  if (!createButton) return;

  const wrapper =
    document.createElement('div');

  wrapper.id = 'nzila-payment-ui';

  wrapper.innerHTML = `
    <div style="margin:12px 0;">
      <label style="display:block;margin-bottom:6px;">
        Mode de paiement
      </label>

      <select
        id="nzilaPaymentMethod"
        style="width:100%;padding:10px;border-radius:8px;"
      >
        <option value="cash">
          Espèces
        </option>

        <option value="mtn_money">
          MTN Mobile Money
        </option>

        <option value="airtel_money">
          Airtel Money
        </option>
      </select>
    </div>
  `;

  createButton.parentNode.insertBefore(
    wrapper,
    createButton
  );

  const select =
    document.getElementById(
      'nzilaPaymentMethod'
    );

  if (select) {
    select.addEventListener(
      'change',
      () => {
        window.NZILA_V2.paymentMethod =
          normalizePaymentMethod(
            select.value
          );
      }
    );
  }
}

/* =========================================================
   CREATION DE COURSE
========================================================= */

async function createRideV2() {
  const user = getCurrentUser();

  if (!user?.id) {
    alert(
      'Vous devez être connecté pour commander une course.'
    );
    return;
  }

  const button =
    document.getElementById('createRide') ||
    document.querySelector(
      '[onclick="createRide()"]'
    );

  if (button) {
    button.disabled = true;
    button.dataset.originalText =
      button.textContent;

    button.textContent =
      'Recherche en cours...';
  }

  try {
    const mode =
      window.clientLocationMode ||
      'manual';

    /* -----------------------------------
       POINT DE DÉPART
    ----------------------------------- */

    const pickupCoords =
      await getPickupCoords();

    const pickupLat =
      Number(pickupCoords[0]);

    const pickupLng =
      Number(pickupCoords[1]);

    /* -----------------------------------
       DESTINATION + ITINÉRAIRE
    ----------------------------------- */

    const quote =
      await quoteRide(pickupCoords);

    const destination =
      quote.destinationAddress ||
      getDestinationValue();

    if (!destination) {
      throw new Error(
        'Indiquez votre destination.'
      );
    }

    /* -----------------------------------
       ADRESSE DE DÉPART
    ----------------------------------- */

    let pickupAddress =
      'Ma position actuelle';

    if (mode !== 'gps') {
      const manual =
        getManualPickupAddress();

      pickupAddress = [
        manual.pickup,
        manual.neighborhood,
        manual.city,
        manual.department
      ].filter(Boolean).join(', ');
    }

    /* -----------------------------------
       PAIEMENT
    ----------------------------------- */

    const selectedPayment =
      document.getElementById(
        'nzilaPaymentMethod'
      )?.value ||
      window.NZILA_V2.paymentMethod ||
      'cash';

    const paymentMethod =
      normalizePaymentMethod(
        selectedPayment
      );

    /* -----------------------------------
       PLANIFICATION
    ----------------------------------- */

    const scheduledAt =
      document.getElementById(
        'scheduledAt'
      )?.value ||
      null;

    /* -----------------------------------
       CRÉATION SUPABASE
    ----------------------------------- */

    const { data, error } =
      await sb.rpc(
        'nzila_create_ride_app',
        {
          p_user_id:
            user.id,

          p_pickup_address:
            pickupAddress,

          p_destination_address:
            destination,

          p_estimated_price:
            Number(
              quote.estimatedPrice ||
              localPriceFallback(
                quote.distanceKm
              )
            ),

          p_payment_method:
            paymentMethod,

          p_pickup_latitude:
            pickupLat,

          p_pickup_longitude:
            pickupLng,

          p_destination_latitude:
            quote.destinationLatitude,

          p_destination_longitude:
            quote.destinationLongitude
        }
      );

    if (error) {
      throw error;
    }

    const ride =
      Array.isArray(data)
        ? data[0]
        : data;

    const rideId =
      ride?.id ??
      ride?.ride_id ??
      data;

    if (!rideId) {
      throw new Error(
        'La course a été créée mais son identifiant est introuvable.'
      );
    }

    /* -----------------------------------
       DONNÉES ITINÉRAIRE OPTIONNELLES
    ----------------------------------- */

    if (
      quote.destinationLatitude != null &&
      quote.destinationLongitude != null
    ) {
      try {
        await sb.rpc(
          'nzila_apply_route_data',
          {
            p_ride_id: rideId,
            p_distance_km:
              quote.distanceKm,
            p_duration_min:
              quote.durationMin,
            p_destination_latitude:
              quote.destinationLatitude,
            p_destination_longitude:
              quote.destinationLongitude
          }
        );
      } catch (routeError) {
        console.warn(
          'Application des données itinéraire ignorée :',
          routeError
        );
      }
    }

    /* -----------------------------------
       COURSE PROGRAMMÉE
    ----------------------------------- */

    if (scheduledAt) {
      try {
        const {
          error: scheduleError
        } = await sb.rpc(
          'nzila_schedule_ride',
          {
            p_ride_id: rideId,
            p_scheduled_at: scheduledAt
          }
        );

        if (scheduleError) {
          console.warn(
            'Planification indisponible :',
            scheduleError
          );
        }
      } catch (scheduleError) {
        console.warn(
          'Erreur planification :',
          scheduleError
        );
      }
    }

    /* -----------------------------------
       MATCHING IMMÉDIAT
    ----------------------------------- */

    if (!scheduledAt) {
      try {
        const {
          data: matchData,
          error: matchError
        } = await sb.rpc(
          'nzila_match_ride',
          {
            p_ride_id: rideId
          }
        );

        if (matchError) {
          console.warn(
            'Matching automatique :',
            matchError
          );
        } else {
          console.log(
            'Résultat matching :',
            matchData
          );
        }
      } catch (matchError) {
        console.warn(
          'Matching indisponible :',
          matchError
        );
      }
    }

    /* -----------------------------------
       RÉCUPÉRATION DE LA COURSE
    ----------------------------------- */

    const {
      data: rideData,
      error: rideFetchError
    } = await sb
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single();

    if (rideFetchError) {
      console.warn(
        'Impossible de récupérer la course :',
        rideFetchError
      );
    }

    const finalRide =
      rideData || ride;

    /* -----------------------------------
       AFFICHAGE
    ----------------------------------- */

    if (
      typeof window.showRideModal ===
      'function'
    ) {
      window.showRideModal(
        finalRide
      );
    }

    if (
      typeof window.renderRideState ===
      'function'
    ) {
      window.renderRideState(
        finalRide
      );
    }

    /* -----------------------------------
       ABONNEMENT TEMPS RÉEL
    ----------------------------------- */

    subscribeToRide(
      rideId,
      user.id
    );

    return finalRide;

  } catch (error) {
    console.error(
      'Erreur création course :',
      error
    );

    /* -----------------------------------
       MODE HORS-LIGNE
    ----------------------------------- */

    try {
      await queueClientAction(
        'create_ride',
        {
          user_id: user.id,
          payment_method:
            window.NZILA_V2.paymentMethod
        }
      );

      alert(
        'Connexion indisponible. Votre demande sera synchronisée dès que possible.'
      );

    } catch (queueError) {
      console.error(
        'Erreur file hors-ligne :',
        queueError
      );

      alert(
        error?.message ||
        'Impossible de créer la course.'
      );
    }

    return null;

  } finally {
    if (button) {
      button.disabled = false;

      button.textContent =
        button.dataset.originalText ||
        'Rechercher un trajet';
    }
  }
}

/* =========================================================
   SUIVI TEMPS RÉEL DE LA COURSE
========================================================= */

function subscribeToRide(
  rideId,
  userId
) {
  if (!rideId || !sb) {
    return;
  }

  const channelName =
    `nzila-client-ride-${rideId}`;

  try {
    sb.removeChannel(
      sb.channel(channelName)
    );
  } catch (_) {}

  const channel =
    sb
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
          filter:
            `id=eq.${rideId}`
        },
        payload => {
          console.log(
            'Mise à jour course :',
            payload
          );

          const ride =
            payload.new ||
            payload.old;

          if (
            typeof window.renderRideState ===
            'function'
          ) {
            window.renderRideState(
              ride
            );
          }

          if (
            typeof window.showRideModal ===
            'function'
          ) {
            window.showRideModal(
              ride
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter:
            `user_id=eq.${userId}`
        },
        payload => {
          console.log(
            'Notification reçue :',
            payload.new
          );

          const notification =
            payload.new;

          if (
            typeof window.showNotification ===
            'function'
          ) {
            window.showNotification(
              notification
            );
          }
        }
      )
      .subscribe(
        status => {
          console.log(
            `Realtime course ${rideId}:`,
            status
          );
        }
      );

  return channel;
}

/* =========================================================
   PAIEMENT MOBILE
========================================================= */

async function startMobilePayment(
  rideId,
  paymentMethod
) {
  if (!rideId) {
    throw new Error(
      'Identifiant de course manquant.'
    );
  }

  const method =
    normalizePaymentMethod(
      paymentMethod
    );

  if (method === 'cash') {
    return {
      success: true,
      method: 'cash'
    };
  }

  try {
    const {
      data,
      error
    } = await sb.functions.invoke(
      'payment-create',
      {
        body: {
          ride_id: rideId,
          payment_method: method
        }
      }
    );

    if (error) {
      throw error;
    }

    return data;

  } catch (error) {
    console.error(
      'Erreur paiement mobile :',
      error
    );

    throw error;
  }
}

/* =========================================================
   ANNULATION
========================================================= */

async function cancelActiveRideV2(
  rideId,
  reason = 'cancelled_by_client'
) {
  if (!rideId) {
    throw new Error(
      'Aucune course active.'
    );
  }

  const {
    data,
    error
  } = await sb.rpc(
    'nzila_update_ride_status',
    {
      p_ride_id: rideId,
      p_status: 'cancelled',
      p_reason: reason
    }
  );

  if (error) {
    throw error;
  }

  /* -----------------------------------
     REMBOURSEMENT SI NÉCESSAIRE
  ----------------------------------- */

  try {
    await sb.functions.invoke(
      'payment-refund',
      {
        body: {
          ride_id: rideId
        }
      }
    );
  } catch (refundError) {
    console.warn(
      'Remboursement automatique indisponible :',
      refundError
    );
  }

  return data;
}

/* =========================================================
   INITIALISATION
========================================================= */

document.addEventListener(
  'DOMContentLoaded',
  () => {
    addPaymentUI();

    /*
     * Synchronisation éventuelle de la file
     * hors-ligne.
     */
    try {
      flushClientQueue();
    } catch (error) {
      console.warn(
        'Flush client queue :',
        error
      );
    }
  }
);

/* =========================================================
   API GLOBALE
========================================================= */

window.createRide =
  createRideV2;

window.cancelActiveRide =
  cancelActiveRideV2;

window.startMobilePayment =
  startMobilePayment;

window.quoteRide =
  quoteRide;

window.getPickupCoords =
  getPickupCoords;
