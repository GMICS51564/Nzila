async function createRideV2() {
  // Récupération de l'utilisateur depuis la variable globale
  // ou depuis la session sauvegardée localement.
  let user = getCurrentUser();

  if (!user?.id) {
    try {
      const savedSession = JSON.parse(
        localStorage.getItem('nzila_client_session') || 'null'
      );

      if (savedSession?.id) {
        user = savedSession;

        // Réhydrate également la variable globale si elle existe
        window.user = savedSession;
        window.currentUser = savedSession;
      }
    } catch (sessionError) {
      console.warn(
        'Impossible de récupérer la session client :',
        sessionError
      );
    }
  }

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
