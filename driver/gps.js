import { createOfflineQueue } from '../assets/js/nzila-utils.js';

const DRIVER_QUEUE_KEY = 'nzila_driver_action_queue';
const driverQueue = createOfflineQueue(DRIVER_QUEUE_KEY);

/*
 * On conserve les fonctions originales du Driver.
 */
const originalStartGps = window.startGps;
const originalStopGps = window.stopGps;

const originalAcceptOffer = window.acceptOffer;
const originalArrived = window.arrived;
const originalStartTrip = window.startTrip;
const originalFinishTrip = window.finishTrip;

let gpsRefreshTimer = null;

/*
 * Démarre le GPS original.
 */
window.startGps = function () {

  if (typeof originalStartGps !== 'function') {
    console.warn('NZILA GPS : startGps original indisponible');
    return;
  }

  originalStartGps();

  /*
   * Toutes les 30 secondes, on redémarre le watch GPS.
   *
   * L'objectif est d'éviter qu'un navigateur conserve
   * trop longtemps une position ancienne.
   */
  if (gpsRefreshTimer) {
    clearInterval(gpsRefreshTimer);
  }

  gpsRefreshTimer = setInterval(() => {

    if (!navigator.onLine) {
      return;
    }

    if (typeof originalStopGps === 'function') {
      originalStopGps();
    }

    setTimeout(() => {
      if (typeof originalStartGps === 'function') {
        originalStartGps();
      }
    }, 300);

  }, 30000);
};


/*
 * Arrêt propre du GPS.
 */
window.stopGps = function () {

  if (gpsRefreshTimer) {
    clearInterval(gpsRefreshTimer);
    gpsRefreshTimer = null;
  }

  if (typeof originalStopGps === 'function') {
    originalStopGps();
  }
};


/*
 * Gestion des actions critiques hors connexion.
 */
async function queueOrRun(action, originalFunction) {

  if (!navigator.onLine) {

    driverQueue.push(action);

    if (typeof window.showToast === 'function') {
      window.showToast(
        'Hors connexion : action enregistrée.'
      );
    }

    return;
  }

  if (typeof originalFunction === 'function') {
    return originalFunction();
  }
}


/*
 * Accepter une course.
 */
window.acceptOffer = function () {
  return queueOrRun(
    { type: 'accept_offer' },
    originalAcceptOffer
  );
};


/*
 * Chauffeur arrivé.
 */
window.arrived = function () {
  return queueOrRun(
    { type: 'arrived' },
    originalArrived
  );
};


/*
 * Début de course.
 */
window.startTrip = function () {
  return queueOrRun(
    { type: 'start_trip' },
    originalStartTrip
  );
};


/*
 * Fin de course.
 */
window.finishTrip = function () {
  return queueOrRun(
    { type: 'finish_trip' },
    originalFinishTrip
  );
};


/*
 * Synchronisation des actions hors connexion.
 */
async function flushDriverQueue() {

  if (!navigator.onLine) {
    return;
  }

  const actions = driverQueue.read();

  for (const action of actions) {

    try {

      if (
        action.type === 'accept_offer' &&
        typeof originalAcceptOffer === 'function'
      ) {
        await originalAcceptOffer();
      }

      if (
        action.type === 'arrived' &&
        typeof originalArrived === 'function'
      ) {
        await originalArrived();
      }

      if (
        action.type === 'start_trip' &&
        typeof originalStartTrip === 'function'
      ) {
        await originalStartTrip();
      }

      if (
        action.type === 'finish_trip' &&
        typeof originalFinishTrip === 'function'
      ) {
        await originalFinishTrip();
      }

      driverQueue.remove(action.id);

    } catch (error) {

      console.warn(
        'Action chauffeur toujours en attente:',
        action,
        error
      );

    }
  }
}


/*
 * Dès que la connexion revient,
 * on synchronise les actions en attente.
 */
window.addEventListener(
  'online',
  flushDriverQueue
);

window.flushDriverQueue = flushDriverQueue;
