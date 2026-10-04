import { createOfflineQueue } from '../assets/js/nzila-utils.js';

const QUEUE_KEY = 'nzila_client_action_queue';

const queue = createOfflineQueue(QUEUE_KEY);

export function queueClientAction(action) {
  queue.push(action);
}

export async function flushClientQueue() {
  if (!navigator.onLine) return;

  const actions = queue.read();

  for (const action of actions) {
    try {
      if (action.type === 'rpc') {
        const { sb } = window;

        if (!sb) {
          throw new Error('SUPABASE_CLIENT_NOT_READY');
        }

        const { error } = await sb.rpc(
          action.rpc,
          action.params || {}
        );

        if (error) throw error;
      }

      queue.remove(action.id);

    } catch (error) {
      console.warn(
        'Action client toujours en attente:',
        action,
        error
      );
    }
  }
}

window.addEventListener('online', () => {
  flushClientQueue();
});
