import { createOfflineQueue } from '../assets/js/nzila-utils.js';

const DRIVER_QUEUE_KEY = 'nzila_driver_action_queue';
const driverQueue = createOfflineQueue(DRIVER_QUEUE_KEY);

const originalStartGps = window.startGps;
const originalAcceptOffer = window.acceptOffer;
const originalArrived = window.arrived;
const originalStartTrip = window.startTrip;
const originalFinishTrip = window.finishTrip;

window.startGps = function () {
  if (typeof originalStartGps !== 'function') {
    console.warn('NZILA: startGps original indisponible');
    return;
  }

  return originalStartGps();
};

async function queueOrRun(action, originalFunction) {
  if (!navigator.onLine) {
    driverQueue.push(action);

    if (typeof showToast === 'function') {
      showToast('Hors connexion : action enregistrée.');
    }

    return;
  }

  if (typeof originalFunction === 'function') {
    return originalFunction();
  }
}

window.acceptOffer = function () {
  return queueOrRun(
    { type: 'accept_offer' },
    originalAcceptOffer
  );
};

window.arrived = function () {
  return queueOrRun(
    { type: 'arrived' },
    originalArrived
  );
};

window.startTrip = function () {
  return queueOrRun(
    { type: 'start_trip' },
    originalStartTrip
  );
};

window.finishTrip = function () {
  return queueOrRun(
    { type: 'finish_trip' },
    originalFinishTrip
  );
};

async function flushDriverQueue() {
  if (!navigator.onLine) return;

  const actions = driverQueue.read();

  for (const action of actions) {
    try {
      if (action.type === 'accept_offer' &&
          typeof originalAcceptOffer === 'function') {
        await originalAcceptOffer();
      }

      if (action.type === 'arrived' &&
          typeof originalArrived === 'function') {
        await originalArrived();
      }

      if (action.type === 'start_trip' &&
          typeof originalStartTrip === 'function') {
        await originalStartTrip();
      }

      if (action.type === 'finish_trip' &&
          typeof originalFinishTrip === 'function') {
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

window.addEventListener('online', flushDriverQueue);

window.flushDriverQueue = flushDriverQueue;
